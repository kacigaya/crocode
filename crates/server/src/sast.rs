//! Static analysis with OpenGrep before the agent runs.
//!
//! The sandbox image ships OpenGrep and a curated copy of `opengrep-rules`.
//! The scan runs in its own sandbox container with no network and no
//! credentials. It loads only the rule directories for the languages of the
//! changed files, plus the generic rules such as secret detection, so a
//! typical scan takes under a minute.
//!
//! Results on added lines go to the agent as untrusted hints. The agent checks
//! each one and reports only real problems. A failed scan never fails the
//! review: the review continues without hints.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;

use crocode_core::diff::{FileDiff, LineKind};
use crocode_core::prompt::SastHint;
use serde::Deserialize;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::sandbox::{self, RunError};
use crate::settings::{SandboxMode, Settings};

/// Hints passed to the agent and stored for the dashboard.
pub const MAX_HINTS: usize = 50;
const MAX_MESSAGE_CHARS: usize = 500;
/// Per-file rule timeout, in seconds, for OpenGrep.
const RULE_TIMEOUT_SECS: &str = "10";
const MAX_TARGET_BYTES: &str = "1000000";
/// The Docker image unpacks the OpenGrep onefile binary here at build time,
/// so the scan needs no writable, executable directory at run time.
const IMAGE_CACHE_DIR: &str = "/opt/opengrep-cache";

/// Rule directories always loaded, such as secret detection.
const ALWAYS: &[&str] = &["generic", "ai/generic"];

/// File extensions and the rule directories that cover them.
const LANGUAGES: &[(&[&str], &[&str])] = &[
    (&["py", "pyi"], &["python", "ai/python"]),
    (
        &["js", "jsx", "mjs", "cjs"],
        &["javascript", "ai/typescript"],
    ),
    (
        &["ts", "tsx", "mts", "cts"],
        &["typescript", "javascript", "ai/typescript"],
    ),
    (&["go"], &["go", "ai/go"]),
    (&["java"], &["java"]),
    (&["kt", "kts"], &["kotlin", "ai/kotlin"]),
    (&["scala"], &["scala"]),
    (&["swift"], &["swift", "ai/swift"]),
    (&["dart"], &["ai/dart"]),
    (&["rb"], &["ruby"]),
    (&["php"], &["php"]),
    (&["rs"], &["rust"]),
    (&["c", "h", "cc", "cpp", "cxx", "hpp"], &["c"]),
    (&["cs"], &["csharp", "ai/csharp"]),
    (&["sh", "bash"], &["bash"]),
    (&["tf", "hcl"], &["terraform"]),
    (&["yml", "yaml"], &["yaml"]),
    (&["json"], &["json"]),
    (&["html", "htm"], &["html"]),
    (&["ex", "exs"], &["elixir"]),
    (&["clj", "cljs", "cljc"], &["clojure"]),
    (&["ml", "mli"], &["ocaml"]),
    (&["sol"], &["solidity"]),
    (&["cls", "trigger"], &["apex"]),
    (&["jsonnet", "libsonnet"], &["libsonnet"]),
];

/// Rule directories, relative to the rules root, for the changed files.
pub fn rule_dirs<'a>(paths: impl IntoIterator<Item = &'a str>) -> Vec<&'static str> {
    let mut dirs: BTreeSet<&'static str> = ALWAYS.iter().copied().collect();
    for path in paths {
        let name = path.rsplit('/').next().unwrap_or(path);
        if name == "Dockerfile" || name.starts_with("Dockerfile.") || name.ends_with(".dockerfile")
        {
            dirs.insert("dockerfile");
            continue;
        }
        let Some((_, ext)) = name.rsplit_once('.') else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        if let Some((_, rules)) = LANGUAGES
            .iter()
            .find(|(exts, _)| exts.contains(&ext.as_str()))
        {
            dirs.extend(rules.iter().copied());
        }
    }
    dirs.into_iter().collect()
}

/// `opengrep scan` for the given files.
///
/// Repository files cannot weaken the scan: `.semgrepignore` files and
/// `nosemgrep` comments are ignored, and `--` stops a path from reading as a
/// flag.
pub fn command(rules_root: &str, dirs: &[&str], paths: &[&str]) -> Vec<String> {
    let mut argv: Vec<String> = [
        "opengrep",
        "scan",
        "--json",
        "--disable-version-check",
        "--disable-nosem",
        "--x-ignore-semgrepignore-files",
        "--no-git-ignore",
        "--timeout",
        RULE_TIMEOUT_SECS,
        "--max-target-bytes",
        MAX_TARGET_BYTES,
    ]
    .map(String::from)
    .to_vec();
    for dir in dirs {
        argv.push("--config".into());
        argv.push(format!("{}/{dir}", rules_root.trim_end_matches('/')));
    }
    argv.push("--".into());
    argv.extend(paths.iter().map(|p| p.to_string()));
    argv
}

#[derive(Deserialize)]
struct Report {
    results: Vec<RawResult>,
    #[serde(default)]
    errors: Vec<ReportError>,
}

#[derive(Deserialize)]
struct ReportError {
    #[serde(default)]
    level: String,
}

#[derive(Deserialize)]
struct RawResult {
    check_id: String,
    path: String,
    start: Position,
    end: Position,
    extra: Extra,
}

#[derive(Deserialize)]
struct Position {
    line: u32,
}

#[derive(Deserialize)]
struct Extra {
    #[serde(default)]
    message: String,
    #[serde(default)]
    severity: String,
}

/// OpenGrep prefixes rule IDs with the config path, such as
/// `opt.opengrep-rules.python.x`. Keeps the part after the rules root.
fn rule_id(check_id: &str, rules_root: &str) -> String {
    let prefix = format!("{}.", rules_root.trim_matches('/').replace('/', "."));
    check_id
        .strip_prefix(&prefix)
        .unwrap_or(check_id)
        .to_owned()
}

fn severity_rank(severity: &str) -> u8 {
    match severity {
        "error" => 0,
        "warning" => 1,
        _ => 2,
    }
}

pub struct Parsed {
    pub hints: Vec<SastHint>,
    /// Errors at level `error`, such as a rule that failed to load or a
    /// file that timed out. Results can then be missing.
    pub errors: usize,
}

/// Results whose lines touch an added line of the diff, most severe first.
pub fn parse(
    stdout: &str,
    rules_root: &str,
    diffs: &HashMap<String, FileDiff>,
) -> anyhow::Result<Parsed> {
    let report: Report = serde_json::from_str(stdout.trim())?;
    let errors = report
        .errors
        .iter()
        .filter(|e| e.level.eq_ignore_ascii_case("error"))
        .count();
    let mut seen = HashSet::new();
    let mut hints: Vec<SastHint> = report
        .results
        .into_iter()
        .filter_map(|r| {
            let path = r.path.strip_prefix("./").unwrap_or(&r.path).to_owned();
            let diff = diffs.get(&path)?;
            let (line, end_line) = (r.start.line, r.end.line.max(r.start.line));
            // Walks only the diff lines inside the match, so long matches stay cheap.
            let added = diff
                .lines
                .range(line..=end_line)
                .any(|(_, l)| l.kind == LineKind::Added);
            if !added {
                return None;
            }
            let rule_id = rule_id(&r.check_id, rules_root);
            if !seen.insert((rule_id.clone(), path.clone(), line)) {
                return None;
            }
            let message: String = r
                .extra
                .message
                .chars()
                .map(|c| if c.is_control() { ' ' } else { c })
                .take(MAX_MESSAGE_CHARS)
                .collect();
            Some(SastHint {
                path,
                line,
                end_line,
                severity: r.extra.severity.to_ascii_lowercase(),
                rule_id,
                message: message.trim().to_owned(),
            })
        })
        .collect();
    hints.sort_by(|a, b| {
        severity_rank(&a.severity)
            .cmp(&severity_rank(&b.severity))
            .then_with(|| a.path.cmp(&b.path))
            .then(a.line.cmp(&b.line))
    });
    hints.truncate(MAX_HINTS);
    Ok(Parsed { hints, errors })
}

pub enum Outcome {
    /// `partial` is true when OpenGrep reported errors, so some results can
    /// be missing. The agent still gets the results it has.
    Completed { hints: Vec<SastHint>, partial: bool },
    /// `failed` or `timed_out`. The review continues without hints.
    Failed(&'static str),
}

impl Outcome {
    pub fn status(&self) -> &'static str {
        match self {
            Self::Completed { partial: false, .. } => "completed",
            Self::Completed { partial: true, .. } => "partial",
            Self::Failed(status) => status,
        }
    }
}

pub struct Dirs<'a> {
    pub name: String,
    pub repo: &'a Path,
    pub input: &'a Path,
    pub output: &'a Path,
}

/// Runs the scan. Only cancellation is an error.
pub async fn scan(
    settings: &Settings,
    dirs: Dirs<'_>,
    diffs: &HashMap<String, FileDiff>,
    cancel: &CancellationToken,
) -> Result<Outcome, RunError> {
    let mut paths: Vec<&str> = diffs.keys().map(String::as_str).collect();
    paths.sort_unstable();
    let rule_dirs = rule_dirs(paths.iter().copied());
    let mut settings = settings.clone();
    settings.agent_timeout = settings.sast_timeout;
    let env = match settings.sandbox {
        SandboxMode::Docker => vec![("XDG_CACHE_HOME".into(), IMAGE_CACHE_DIR.into())],
        SandboxMode::None => Vec::new(),
    };
    let started = std::time::Instant::now();
    let result = sandbox::run(
        &settings,
        sandbox::Job {
            name: dirs.name,
            repo_dir: dirs.repo,
            input_dir: dirs.input,
            output_dir: dirs.output,
            argv: command(&settings.sast_rules_dir, &rule_dirs, &paths),
            env,
            // No credentials and no network: the scan needs neither.
            passthrough: Vec::new(),
            stdin: String::new(),
            codex_auth: false,
            offline: true,
        },
        cancel,
    )
    .await;
    let output = match result {
        Ok(output) => output,
        Err(RunError::Cancelled) => return Err(RunError::Cancelled),
        Err(RunError::Timeout(_)) => {
            warn!("static analysis timed out");
            return Ok(Outcome::Failed("timed_out"));
        }
        Err(RunError::Other(err)) => {
            warn!(error = %format!("{err:#}"), "static analysis could not start");
            return Ok(Outcome::Failed("failed"));
        }
    };
    let stderr_tail = || -> String {
        let tail: Vec<char> = output.stderr.chars().rev().take(300).collect();
        tail.into_iter().rev().collect()
    };
    // A failed process can still print valid JSON with no results. That is
    // not a clean scan.
    if !output.success {
        warn!(stderr = %stderr_tail(), "static analysis exited with an error");
        return Ok(Outcome::Failed("failed"));
    }
    match parse(&output.stdout, &settings.sast_rules_dir, diffs) {
        Ok(Parsed { hints, errors }) => {
            info!(
                results = hints.len(),
                errors,
                rule_dirs = rule_dirs.len(),
                secs = started.elapsed().as_secs(),
                "static analysis finished"
            );
            Ok(Outcome::Completed {
                hints,
                partial: errors > 0,
            })
        }
        Err(err) => {
            warn!(error = %err, stderr = %stderr_tail(), "static analysis output unreadable");
            Ok(Outcome::Failed("failed"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_dirs_follow_changed_languages() {
        assert_eq!(rule_dirs(["README.md"]), ["ai/generic", "generic"]);
        assert_eq!(
            rule_dirs(["src/app.PY", "web/x.tsx", "deploy/Dockerfile", "Makefile"]),
            [
                "ai/generic",
                "ai/python",
                "ai/typescript",
                "dockerfile",
                "generic",
                "javascript",
                "python",
                "typescript"
            ]
        );
    }

    #[test]
    fn command_keeps_paths_after_the_separator() {
        let argv = command(
            "/opt/opengrep-rules/",
            &["python"],
            &["--config=evil.yml", "a.py"],
        );
        let sep = argv.iter().position(|a| a == "--").unwrap();
        assert_eq!(&argv[sep + 1..], ["--config=evil.yml", "a.py"]);
        assert!(
            argv[..sep]
                .windows(2)
                .any(|w| w == ["--config", "/opt/opengrep-rules/python"])
        );
        for flag in [
            "--disable-nosem",
            "--x-ignore-semgrepignore-files",
            "--json",
        ] {
            assert!(argv[..sep].iter().any(|a| a == flag), "{flag}");
        }
    }

    // Shape from OpenGrep 1.33.1 output on 2026-11-03.
    const OUTPUT: &str = r#"{"results":[
        {"check_id":"opt.opengrep-rules.python.lang.security.audit.subprocess-shell-true","path":"app.py",
         "start":{"line":3,"col":5},"end":{"line":3,"col":44},
         "extra":{"message":"Found 'subprocess'\nwith 'shell=True'.","severity":"ERROR","lines":"x"}},
        {"check_id":"opt.opengrep-rules.python.lang.security.audit.subprocess-shell-true","path":"./app.py",
         "start":{"line":3,"col":5},"end":{"line":3,"col":44},"extra":{"message":"dup","severity":"ERROR"}},
        {"check_id":"opt.opengrep-rules.javascript.browser.security.eval-detected","path":"web.js",
         "start":{"line":1,"col":1},"end":{"line":1,"col":9},"extra":{"message":"eval","severity":"WARNING"}},
        {"check_id":"opt.opengrep-rules.python.x","path":"app.py",
         "start":{"line":1,"col":1},"end":{"line":1,"col":5},"extra":{"message":"context line","severity":"ERROR"}},
        {"check_id":"opt.opengrep-rules.python.x","path":"other.py",
         "start":{"line":3,"col":1},"end":{"line":3,"col":5},"extra":{"message":"not in diff","severity":"ERROR"}}
    ],"errors":[],"paths":{"scanned":["app.py","web.js"]}}"#;

    #[test]
    fn parse_keeps_added_lines_and_orders_by_severity() {
        let diffs: HashMap<String, FileDiff> = [
            (
                "app.py".to_owned(),
                FileDiff::parse("app.py", "@@ -1,2 +1,3 @@\n import subprocess\n def run(cmd):\n+    return subprocess.call(cmd, shell=True)"),
            ),
            ("web.js".to_owned(), FileDiff::parse("web.js", "@@ -0,0 +1 @@\n+eval(x)")),
        ]
        .into();
        let parsed = parse(OUTPUT, "/opt/opengrep-rules", &diffs).unwrap();
        assert_eq!(parsed.errors, 0);
        let hints = parsed.hints;
        let summary: Vec<(&str, &str, u32, &str)> = hints
            .iter()
            .map(|h| {
                (
                    h.rule_id.as_str(),
                    h.path.as_str(),
                    h.line,
                    h.severity.as_str(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                (
                    "python.lang.security.audit.subprocess-shell-true",
                    "app.py",
                    3,
                    "error"
                ),
                (
                    "javascript.browser.security.eval-detected",
                    "web.js",
                    1,
                    "warning"
                ),
            ]
        );
        assert_eq!(hints[0].message, "Found 'subprocess' with 'shell=True'.");
        assert!(parse("not json", "/opt/opengrep-rules", &diffs).is_err());
    }

    #[test]
    fn long_matches_and_report_errors() {
        // An added line far inside a long match still counts.
        let patch = format!("@@ -1,0 +300,1 @@\n+{}", "x");
        let diffs: HashMap<String, FileDiff> =
            [("a.py".to_owned(), FileDiff::parse("a.py", &patch))].into();
        let output = r#"{"results":[{"check_id":"r","path":"a.py","start":{"line":10},"end":{"line":400},
            "extra":{"message":"m","severity":"ERROR"}}],
            "errors":[{"level":"warn","message":"syntax"},{"level":"error","message":"rule failed"}]}"#;
        let parsed = parse(output, "/opt/opengrep-rules", &diffs).unwrap();
        assert_eq!((parsed.hints.len(), parsed.errors), (1, 1));
        assert_eq!((parsed.hints[0].line, parsed.hints[0].end_line), (10, 400));
    }

    #[test]
    fn statuses_match_the_database_check() {
        let completed = |partial| Outcome::Completed {
            hints: Vec::new(),
            partial,
        };
        assert_eq!(completed(false).status(), "completed");
        assert_eq!(completed(true).status(), "partial");
        assert_eq!(Outcome::Failed("timed_out").status(), "timed_out");
    }
}
