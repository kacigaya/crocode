use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use crocode_core::config::RepoConfig;
use crocode_core::diff::FileDiff;
use crocode_core::finding::{self, Finding, ValidationOptions};
use crocode_core::prompt::{self, PromptFile};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::agents::{self, Agent};
use crate::review::WorkDir;
use crate::settings::{SandboxMode, Settings};

pub const USAGE: &str = "usage: crocode eval <fixture.json> [--response <envelope.json> | --run] [--agent claude|codex|opencode] [--model <name>] [--adjudication <matches.json>]";

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Fixture {
    id: String,
    title: String,
    #[serde(default)]
    body: String,
    files: Vec<Source>,
    expected: Vec<Expected>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Source {
    path: String,
    content: String,
    patch: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Expected {
    id: String,
    path: String,
    start_line: u32,
    end_line: u32,
    description: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Match {
    bug_id: String,
    fingerprint: String,
}

#[derive(Serialize)]
struct Candidate<'a> {
    expected: &'a Expected,
    finding_fingerprints: Vec<&'a str>,
}

#[derive(Serialize)]
struct Score<'a> {
    location_candidates: Vec<Candidate<'a>>,
    confirmed_bug_ids: Option<Vec<&'a str>>,
    missed_bug_ids: Option<Vec<&'a str>>,
    unconfirmed_finding_fingerprints: Option<Vec<&'a str>>,
}

struct Options {
    fixture: PathBuf,
    response: Option<PathBuf>,
    run: bool,
    agent: Agent,
    model: Option<String>,
    adjudication: Option<PathBuf>,
}

impl Options {
    fn parse(args: Vec<String>) -> Result<Self> {
        let mut args = args.into_iter();
        let fixture = args
            .next()
            .filter(|arg| !arg.starts_with('-'))
            .context(USAGE)?;
        let mut options = Self {
            fixture: fixture.into(),
            response: None,
            run: false,
            agent: Agent::Claude,
            model: None,
            adjudication: None,
        };
        let mut seen = HashSet::new();
        while let Some(flag) = args.next() {
            if !seen.insert(flag.clone()) {
                bail!("duplicate option: {flag}");
            }
            match flag.as_str() {
                "--run" => options.run = true,
                "--response" => options.response = Some(args.next().context(USAGE)?.into()),
                "--agent" => options.agent = args.next().context(USAGE)?.parse()?,
                "--model" => {
                    let model = args.next().context(USAGE)?;
                    if !agents::valid_model(&model) {
                        bail!("invalid model name");
                    }
                    options.model = Some(model);
                }
                "--adjudication" => options.adjudication = Some(args.next().context(USAGE)?.into()),
                _ => bail!("unknown option: {flag}; {USAGE}"),
            }
        }
        if options.run && options.response.is_some() {
            bail!("--run and --response are exclusive");
        }
        if options.adjudication.is_some() && options.response.is_none() {
            bail!("--adjudication requires --response; save the live report first");
        }
        Ok(options)
    }
}

fn read_text(path: &Path) -> Result<String> {
    use std::io::Read;
    let mut text = String::new();
    std::fs::File::open(path)?
        .take(8 * 1024 * 1024 + 1)
        .read_to_string(&mut text)?;
    if text.len() > 8 * 1024 * 1024 {
        bail!("input exceeds 8 MiB");
    }
    Ok(text)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    serde_json::from_str(&read_text(path)?).with_context(|| format!("parse {}", path.display()))
}

fn fixture_diffs(fixture: &Fixture) -> Result<HashMap<String, FileDiff>> {
    if fixture.id.trim().is_empty() || fixture.files.is_empty() {
        bail!("fixture needs an id and files");
    }
    let ignore = RepoConfig::default().ignore_set()?;
    let mut paths = HashSet::new();
    let mut diffs = HashMap::new();
    for source in &fixture.files {
        if finding::normalize_path(&source.path).as_deref() != Some(source.path.as_str())
            || !paths.insert(&source.path)
            || source
                .path
                .split('/')
                .any(|part| part == ".git" || part.starts_with(".env") || part.ends_with(".pem"))
        {
            bail!("unsafe or duplicate fixture path: {}", source.path);
        }
        if let Some(patch) = &source.patch {
            if ignore.is_match(&source.path) {
                bail!(
                    "fixture patch is ignored by production defaults: {}",
                    source.path
                );
            }
            let diff = FileDiff::parse(&source.path, patch);
            if diff.lines.is_empty() {
                bail!("fixture patch has no reviewable lines: {}", source.path);
            }
            let lines: Vec<&str> = source.content.lines().collect();
            for (number, line) in &diff.lines {
                if lines.get((*number - 1) as usize).copied() != Some(line.content.as_str()) {
                    bail!(
                        "fixture head differs from patch at {}:{number}",
                        source.path
                    );
                }
            }
            diffs.insert(source.path.clone(), diff);
        }
    }
    if diffs.is_empty() {
        bail!("fixture needs a reviewable patch");
    }
    let mut ids = HashSet::new();
    for expected in &fixture.expected {
        if expected.id.trim().is_empty()
            || !ids.insert(&expected.id)
            || expected.description.trim().is_empty()
            || expected.start_line == 0
            || expected.end_line < expected.start_line
            || !diffs.contains_key(&expected.path)
            || !fixture.files.iter().any(|source| {
                source.path == expected.path
                    && usize::try_from(expected.end_line)
                        .is_ok_and(|line| line <= source.content.lines().count())
            })
        {
            bail!("invalid expected bug: {}", expected.id);
        }
    }
    Ok(diffs)
}

fn score<'a>(
    expected: &'a [Expected],
    findings: &'a [Finding],
    matches: Option<&[Match]>,
) -> Result<Score<'a>> {
    let candidates: Vec<Candidate<'a>> = expected
        .iter()
        .map(|bug| Candidate {
            expected: bug,
            finding_fingerprints: findings
                .iter()
                .filter(|finding| {
                    finding.path == bug.path
                        && finding.line >= bug.start_line
                        && finding.start_line.unwrap_or(finding.line) <= bug.end_line
                })
                .map(|finding| finding.fingerprint.as_str())
                .collect(),
        })
        .collect();
    let mut confirmed = HashSet::new();
    let mut assigned = HashSet::new();
    if let Some(matches) = matches {
        for matched in matches {
            let candidate = candidates
                .iter()
                .find(|candidate| candidate.expected.id == matched.bug_id)
                .context("adjudication refers to an unknown bug")?;
            if !candidate
                .finding_fingerprints
                .contains(&matched.fingerprint.as_str())
                || !confirmed.insert(candidate.expected.id.as_str())
                || !assigned.insert(matched.fingerprint.as_str())
            {
                bail!("invalid or duplicate adjudication match");
            }
        }
    }
    Ok(Score {
        confirmed_bug_ids: matches.map(|_| {
            expected
                .iter()
                .filter(|bug| confirmed.contains(bug.id.as_str()))
                .map(|bug| bug.id.as_str())
                .collect()
        }),
        missed_bug_ids: matches.map(|_| {
            expected
                .iter()
                .filter(|bug| !confirmed.contains(bug.id.as_str()))
                .map(|bug| bug.id.as_str())
                .collect()
        }),
        unconfirmed_finding_fingerprints: matches.map(|_| {
            findings
                .iter()
                .filter(|finding| !assigned.contains(finding.fingerprint.as_str()))
                .map(|finding| finding.fingerprint.as_str())
                .collect()
        }),
        location_candidates: candidates,
    })
}

type SavedResponse = (
    finding::AgentReview,
    agents::Usage,
    agents::Telemetry,
    Option<i64>,
);

fn saved_response(text: &str, agent: Agent, fixture_sha256: &str) -> Result<SavedResponse> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text)
        && value.get("report_version").is_some()
    {
        if value["report_version"] != 1
            || value["agent"] != agent.name()
            || value["fixture_sha256"] != fixture_sha256
        {
            bail!("saved report version, agent, or fixture does not match");
        }
        return Ok((
            serde_json::from_value(value["agent_review"].clone())?,
            serde_json::from_value(value["usage"].clone())?,
            serde_json::from_value(value["telemetry"].clone())?,
            value["duration_ms"].as_i64(),
        ));
    }
    let result_file = if agent == Agent::Codex {
        Some(text)
    } else {
        None
    };
    Ok((
        agents::parse_output(agent, text, result_file)?,
        agents::parse_usage(agent, text),
        agents::parse_telemetry(agent, text),
        None,
    ))
}

pub async fn execute(args: Vec<String>, cancel: &CancellationToken) -> Result<()> {
    let options = Options::parse(args)?;
    let fixture: Fixture = read_json(&options.fixture)?;
    let diffs = fixture_diffs(&fixture)?;
    if !options.run && options.response.is_none() {
        println!(
            "{}",
            serde_json::json!({"fixture":fixture.id,"status":"validated","patches":diffs.len(),"expected_bugs":fixture.expected.len(),"model_called":false})
        );
        return Ok(());
    }
    let matches: Option<Vec<Match>> = options.adjudication.as_deref().map(read_json).transpose()?;
    use sha2::{Digest, Sha256};
    let fixture_sha256 = hex::encode(Sha256::digest(serde_json::to_vec(&fixture)?));
    let (review, usage, telemetry, duration_ms) = if let Some(response) = options.response {
        saved_response(&read_text(&response)?, options.agent, &fixture_sha256)?
    } else {
        let settings = Settings::runtime_from_env()?;
        if !settings.work_dir.is_absolute() {
            bail!("eval requires an absolute CROCODE_WORK_DIR");
        }
        if settings.sandbox != SandboxMode::Docker {
            bail!("eval --run requires the Docker sandbox");
        }
        if options.agent == Agent::Codex && settings.codex_auth_dir.is_some() {
            bail!("eval does not mount a shared Codex login cache; use CODEX_API_KEY");
        }
        if !settings.agents.contains(&options.agent) {
            bail!("agent is not enabled in CROCODE_AGENTS");
        }
        let work = WorkDir::create(
            &settings.work_dir,
            &format!("eval-{}", uuid::Uuid::new_v4()),
        )
        .await?;
        for child in ["repo", "input", "output"] {
            tokio::fs::create_dir_all(work.path.join(child)).await?;
        }
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(
            work.path.join("output"),
            std::fs::Permissions::from_mode(0o777),
        )
        .await?;
        for source in &fixture.files {
            let path = work.path.join("repo").join(&source.path);
            tokio::fs::create_dir_all(path.parent().context("fixture path needs a parent")?)
                .await?;
            tokio::fs::write(path, &source.content).await?;
        }
        let files: Vec<PromptFile<'_>> = fixture
            .files
            .iter()
            .filter_map(|source| {
                source.patch.as_deref().map(|patch| PromptFile {
                    path: &source.path,
                    patch,
                })
            })
            .collect();
        let prompt = prompt::build(
            &prompt::PullRequest {
                repo: "example/project",
                number: 1,
                title: &fixture.title,
                body: &fixture.body,
                base_ref: "main",
                head_sha: "0000000000000000000000000000000000000001",
            },
            &files,
            None,
            None,
            &uuid::Uuid::new_v4().simple().to_string(),
        );
        let attempt = crate::runner::run(
            &settings,
            crate::runner::Request {
                agent: options.agent,
                model: options.model.as_deref(),
                work_dir: &work.path,
                name: format!("crocode-eval-{}", uuid::Uuid::new_v4().simple()),
                prompt,
                secrets: Vec::new(),
            },
            cancel,
        )
        .await?;
        let review = attempt.review.with_context(|| {
            eprintln!("eval activity: {}", serde_json::json!({"usage":attempt.usage,"telemetry":attempt.telemetry,"duration_ms":attempt.duration_ms}));
            let tail: String = attempt.stderr.chars().rev().take(500).collect::<String>().chars().rev().collect();
            format!("eval agent failed; stderr: {tail}")
        })?;
        (
            review,
            attempt.usage,
            attempt.telemetry,
            Some(attempt.duration_ms),
        )
    };
    let agent_review = serde_json::to_value(&review)?;
    let validated = finding::validate(
        review,
        &diffs,
        &ValidationOptions {
            min_severity: finding::Severity::Low,
            max_inline: 20,
        },
    );
    let score = score(&fixture.expected, &validated.findings, matches.as_deref())?;
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "report_version":1,"fixture":fixture.id,"fixture_sha256":fixture_sha256,"agent_review":agent_review,
            "agent":options.agent.name(),"requested_model":options.model,
            "usage":usage,"telemetry":telemetry,"duration_ms":duration_ms,
            "findings":validated.findings,"dropped_findings":validated.dropped,"summary":validated.summary,"score":score,
            "sast":"not run","model_called":options.run,
        }))?
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("../../../eval/fixtures/regex.json")).unwrap()
    }

    #[test]
    fn fixture_checks_paths_patches_and_expected_ids() {
        let mut fixture = fixture();
        assert!(fixture_diffs(&fixture).is_ok());
        fixture.files[0].path = "../escape.py".into();
        assert!(fixture_diffs(&fixture).is_err());
        fixture.files[0].path = "example.py".into();
        fixture.files[0].content = "wrong".into();
        assert!(fixture_diffs(&fixture).is_err());
    }

    #[test]
    fn fixture_rejects_secret_paths_duplicate_ids_and_impossible_ranges() {
        for path in [
            ".env",
            "src/.env.local",
            ".git/config",
            "keys/private.pem",
            "example.py/../escape",
        ] {
            let mut fixture = fixture();
            fixture.files[0].path = path.into();
            assert!(fixture_diffs(&fixture).is_err(), "{path}");
        }
        let mut duplicate = fixture();
        let bug: Expected =
            serde_json::from_value(serde_json::to_value(&duplicate.expected[0]).unwrap()).unwrap();
        duplicate.expected.push(bug);
        assert!(fixture_diffs(&duplicate).is_err());
        let mut impossible = fixture();
        impossible.expected[0].end_line = 100;
        assert!(fixture_diffs(&impossible).is_err());
    }

    #[test]
    fn bundled_fixtures_have_consistent_heads_and_patches() {
        for source in [
            include_str!("../../../eval/fixtures/regex.json"),
            include_str!("../../../eval/fixtures/regex-fixed.json"),
            include_str!("../../../eval/fixtures/href.json"),
            include_str!("../../../eval/fixtures/modal.json"),
        ] {
            let fixture: Fixture = serde_json::from_str(source).unwrap();
            assert!(fixture_diffs(&fixture).is_ok());
        }
    }

    #[test]
    fn cli_requires_explicit_run_and_rejects_ambiguous_options() {
        assert!(!Options::parse(vec!["fixture.json".into()]).unwrap().run);
        for args in [
            vec!["fixture.json", "--run", "--response", "out.json"],
            vec!["fixture.json", "--model", "--unsafe"],
            vec!["fixture.json", "--run", "--run"],
            vec!["fixture.json", "--run", "--adjudication", "matches.json"],
        ] {
            assert!(Options::parse(args.into_iter().map(str::to_owned).collect()).is_err());
        }
    }

    #[test]
    fn saved_report_preserves_review_metadata_and_checks_identity() {
        let report = serde_json::json!({
            "report_version":1, "agent":"claude", "fixture_sha256":"digest",
            "agent_review":{"summary":"recorded", "findings":[]},
            "usage":{"input_tokens":17,"cached_input_tokens":null,"output_tokens":3,"model":"sonnet"},
            "telemetry":{"turns":2,"api_duration_ms":5,"permission_denials":0}, "duration_ms":20,
        });
        let text = report.to_string();
        let (review, usage, telemetry, duration) =
            saved_response(&text, Agent::Claude, "digest").unwrap();
        assert_eq!(review.summary, "recorded");
        assert_eq!(usage.input_tokens, Some(17));
        assert_eq!(telemetry.turns, Some(2));
        assert_eq!(duration, Some(20));
        assert!(saved_response(&text, Agent::Codex, "digest").is_err());
        assert!(saved_response(&text, Agent::Claude, "different").is_err());
    }

    #[test]
    fn expected_bug_can_be_reported_in_summary_outside_patch_lines() {
        let mut fixture = fixture();
        fixture.files[0].patch = Some(
            "@@ -4 +4 @@\n-old\n+    return re.sub(r\" \\[ref=[^\\]]+\\](?::.*)?$\", \"\", line)\n"
                .into(),
        );
        fixture.expected[0].start_line = 3;
        fixture.expected[0].end_line = 3;
        assert!(fixture_diffs(&fixture).is_ok());
    }

    #[test]
    fn location_overlap_is_not_a_confirmed_bug() {
        let fixture = fixture();
        let findings = vec![Finding {
            path: "example.py".into(),
            start_line: None,
            line: 3,
            severity: finding::Severity::High,
            category: finding::Category::Bug,
            title: "Unrelated issue nearby".into(),
            body: "different bug".into(),
            suggestion: None,
            fingerprint: "f1".into(),
            inline: true,
        }];
        let result = score(&fixture.expected, &findings, None).unwrap();
        assert_eq!(result.location_candidates[0].finding_fingerprints, ["f1"]);
        assert_eq!(result.confirmed_bug_ids, None);
        let result = score(&fixture.expected, &findings, Some(&[])).unwrap();
        assert_eq!(result.missed_bug_ids.unwrap(), ["visible-text"]);
        assert_eq!(result.unconfirmed_finding_fingerprints.unwrap(), ["f1"]);
        let matched = [Match {
            bug_id: "visible-text".into(),
            fingerprint: "f1".into(),
        }];
        assert_eq!(
            score(&fixture.expected, &findings, Some(&matched))
                .unwrap()
                .confirmed_bug_ids
                .unwrap(),
            ["visible-text"]
        );
        assert!(
            score(
                &fixture.expected,
                &findings,
                Some(&[Match {
                    bug_id: "other".into(),
                    fingerprint: "f1".into()
                }])
            )
            .is_err()
        );
    }
}
