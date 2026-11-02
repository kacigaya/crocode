//! Repository configuration loaded from `.crocode.yml`.
//!
//! CroCode reads this file from the pull request base commit, never from the
//! head. A pull request must not be able to change how it gets reviewed.

use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::Deserialize;

use crate::finding::Severity;

pub const CONFIG_PATH: &str = ".crocode.yml";

/// Hard caps that repository config cannot raise.
pub const MAX_COMMENTS_LIMIT: usize = 50;
pub const MAX_INSTRUCTIONS_CHARS: usize = 4_000;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RepoConfig {
    pub enabled: bool,
    /// Agent name. `None` uses the installation or server default.
    pub agent: Option<String>,
    pub model: Option<String>,
    pub review_drafts: bool,
    pub min_severity: Severity,
    pub max_comments: usize,
    pub max_files: usize,
    pub max_changed_lines: usize,
    /// Glob patterns for files to leave out of the review.
    pub ignore: Vec<String>,
    /// Extra review guidance from the repository maintainers.
    pub instructions: Option<String>,
}

impl Default for RepoConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            agent: None,
            model: None,
            review_drafts: false,
            min_severity: Severity::Low,
            max_comments: 20,
            max_files: 100,
            max_changed_lines: 3_000,
            ignore: Vec::new(),
            instructions: None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("invalid {CONFIG_PATH}: {0}")]
    Yaml(#[from] serde_yaml_ng::Error),
    #[error("invalid {CONFIG_PATH}: bad ignore pattern {pattern:?}: {source}")]
    Glob {
        pattern: String,
        source: globset::Error,
    },
}

/// Files that are noise for a code review in almost every repository.
const DEFAULT_IGNORE: &[&str] = &[
    "**/*.lock",
    "**/package-lock.json",
    "**/pnpm-lock.yaml",
    "**/*.min.js",
    "**/*.map",
    "**/*.snap",
    "**/vendor/**",
    "**/node_modules/**",
];

impl RepoConfig {
    /// Parses config text. Empty text gives the defaults.
    pub fn parse(text: &str) -> Result<Self, ConfigError> {
        if text.trim().is_empty() {
            return Ok(Self::default());
        }
        let mut config: Self = serde_yaml_ng::from_str(text)?;
        config.max_comments = config.max_comments.min(MAX_COMMENTS_LIMIT);
        if let Some(text) = &mut config.instructions {
            truncate_chars(text, MAX_INSTRUCTIONS_CHARS);
        }
        // Fail early on bad globs so the user sees the error.
        config.ignore_set()?;
        Ok(config)
    }

    /// Default ignore patterns plus the repository patterns.
    pub fn ignore_set(&self) -> Result<GlobSet, ConfigError> {
        let mut builder = GlobSetBuilder::new();
        for pattern in DEFAULT_IGNORE
            .iter()
            .copied()
            .chain(self.ignore.iter().map(String::as_str))
        {
            let glob = Glob::new(pattern).map_err(|source| ConfigError::Glob {
                pattern: pattern.to_owned(),
                source,
            })?;
            builder.add(glob);
        }
        builder.build().map_err(|source| ConfigError::Glob {
            pattern: String::new(),
            source,
        })
    }
}

pub(crate) fn truncate_chars(text: &mut String, max: usize) {
    if let Some((index, _)) = text.char_indices().nth(max) {
        text.truncate(index);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_gives_defaults() {
        assert_eq!(RepoConfig::parse("").unwrap(), RepoConfig::default());
        assert_eq!(RepoConfig::parse("  \n").unwrap(), RepoConfig::default());
    }

    #[test]
    fn parses_fields_and_caps_limits() {
        let config = RepoConfig::parse(
            "agent: codex\nmin_severity: high\nmax_comments: 500\nignore: ['docs/**']\n",
        )
        .unwrap();
        assert_eq!(config.agent.as_deref(), Some("codex"));
        assert_eq!(config.min_severity, Severity::High);
        assert_eq!(config.max_comments, MAX_COMMENTS_LIMIT);
        let set = config.ignore_set().unwrap();
        assert!(set.is_match("docs/a.md"));
        assert!(set.is_match("web/pnpm-lock.yaml"));
        assert!(!set.is_match("src/main.rs"));
    }

    #[test]
    fn rejects_unknown_fields_and_bad_globs() {
        assert!(RepoConfig::parse("agnet: codex").is_err());
        assert!(RepoConfig::parse("ignore: ['a[']").is_err());
    }

    #[test]
    fn truncates_instructions() {
        let long = "x".repeat(MAX_INSTRUCTIONS_CHARS + 10);
        let config = RepoConfig::parse(&format!("instructions: {long}")).unwrap();
        assert_eq!(
            config.instructions.unwrap().chars().count(),
            MAX_INSTRUCTIONS_CHARS
        );
    }
}
