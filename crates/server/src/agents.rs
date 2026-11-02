//! Command lines and output parsers for the supported agent CLIs.
//!
//! Each agent gets read-only tools only. The prompt arrives on stdin. Flags
//! come from each CLI's `--help` and official docs:
//! - Claude Code: <https://code.claude.com/docs/en/headless>
//! - Codex: <https://learn.chatgpt.com/docs/codex-sdk> (`codex exec`)
//! - OpenCode: <https://opencode.ai/docs/cli/>, <https://opencode.ai/docs/permissions/>

use std::str::FromStr;

use anyhow::{Context, Result, anyhow, bail};
use crocode_core::finding::AgentReview;
use crocode_core::prompt::{extract_json_object, output_schema};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Agent {
    Claude,
    Codex,
    OpenCode,
}

impl Agent {
    pub fn name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::OpenCode => "opencode",
        }
    }

    /// Credentials the agent may read. Values come from the worker
    /// environment and are never written to the command line.
    pub fn env_names(self) -> &'static [&'static str] {
        match self {
            Self::Claude => &[
                "ANTHROPIC_API_KEY",
                "CLAUDE_CODE_OAUTH_TOKEN",
                "ANTHROPIC_BASE_URL",
                "CLAUDE_CODE_USE_BEDROCK",
                "CLAUDE_CODE_USE_VERTEX",
            ],
            Self::Codex => &["CODEX_API_KEY", "OPENAI_BASE_URL"],
            Self::OpenCode => &[
                "ANTHROPIC_API_KEY",
                "OPENAI_API_KEY",
                "OPENROUTER_API_KEY",
                "OPENCODE_API_KEY",
            ],
        }
    }
}

impl FromStr for Agent {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "claude" => Ok(Self::Claude),
            "codex" => Ok(Self::Codex),
            "opencode" => Ok(Self::OpenCode),
            other => bail!("unknown agent {other:?}; expected claude, codex, or opencode"),
        }
    }
}

/// Model names go on the agent command line, so allow only plain names.
/// A leading `-` could turn the value into a flag.
pub fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 100
        && !model.starts_with('-')
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:/@#-[]".contains(c))
}

/// Paths as the agent process sees them.
pub struct Paths {
    pub repo: String,
    pub input: String,
    pub output: String,
}

pub const SCHEMA_FILE: &str = "schema.json";
pub const RESULT_FILE: &str = "result.json";

/// OpenCode permissions: read and search only. Everything else is denied,
/// including paths outside the repository and the loop-detection prompt.
const OPENCODE_CONFIG: &str = r#"{"$schema":"https://opencode.ai/config.json","permission":{"*":"deny","read":"allow","glob":"allow","grep":"allow","external_directory":"deny","doom_loop":"deny"},"share":"disabled","autoupdate":false}"#;

/// True when Claude must authenticate with a subscription token from
/// `claude setup-token`. An API key takes precedence.
pub fn claude_uses_subscription() -> bool {
    let set = |name| std::env::var_os(name).is_some_and(|value| !value.is_empty());
    set("CLAUDE_CODE_OAUTH_TOKEN") && !set("ANTHROPIC_API_KEY")
}

/// Returns argv and extra fixed environment for one agent run.
///
/// `subscription` applies to Claude only. See [`claude_uses_subscription`].
pub fn command(
    agent: Agent,
    model: Option<&str>,
    paths: &Paths,
    subscription: bool,
) -> (Vec<String>, Vec<(String, String)>) {
    let mut argv: Vec<String> = Vec::new();
    let mut env: Vec<(String, String)> = Vec::new();
    match agent {
        Agent::Claude => {
            argv.extend(
                [
                    "claude",
                    "-p",
                    // `--bare` never reads OAuth credentials. `--safe-mode`
                    // accepts them and still skips CLAUDE.md, hooks, plugins,
                    // skills, and MCP servers from the repository.
                    if subscription {
                        "--safe-mode"
                    } else {
                        "--bare"
                    },
                    // Confines file tools to the working directory and
                    // removes Bash and WebFetch.
                    "--restricted",
                    "--strict-mcp-config",
                    "--tools",
                    "Read,Grep,Glob",
                    "--allowedTools",
                    "Read,Grep,Glob",
                    "--permission-mode",
                    "dontAsk",
                    "--no-session-persistence",
                    "--output-format",
                    "json",
                    "--json-schema",
                ]
                .map(String::from),
            );
            argv.push(output_schema().to_string());
            if let Some(model) = model {
                argv.extend(["--model".into(), model.into()]);
            }
        }
        Agent::Codex => {
            argv.extend(
                [
                    "codex",
                    "exec",
                    // Shell commands may read files but not write or use the network.
                    "--sandbox",
                    "read-only",
                    "--skip-git-repo-check",
                    "--ephemeral",
                    "--ignore-user-config",
                    "--ignore-rules",
                    "--color",
                    "never",
                ]
                .map(String::from),
            );
            argv.extend([
                "--cd".into(),
                paths.repo.clone(),
                "--output-schema".into(),
                format!("{}/{SCHEMA_FILE}", paths.input),
                "--output-last-message".into(),
                format!("{}/{RESULT_FILE}", paths.output),
            ]);
            if let Some(model) = model {
                argv.extend(["--model".into(), model.into()]);
            }
            argv.push("-".into());
        }
        Agent::OpenCode => {
            // Project plugins and MCP commands run before tool permissions apply.
            argv.extend(["opencode", "run", "--pure", "--format", "json"].map(String::from));
            if let Some(model) = model {
                argv.extend(["--model".into(), model.into()]);
            }
            env.push(("OPENCODE_CONFIG_CONTENT".into(), OPENCODE_CONFIG.into()));
            for name in [
                "OPENCODE_DISABLE_PROJECT_CONFIG",
                "OPENCODE_DISABLE_CLAUDE_CODE",
                "OPENCODE_DISABLE_EXTERNAL_SKILLS",
            ] {
                env.push((name.into(), "true".into()));
            }
        }
    }
    (argv, env)
}

/// Parses agent output into a review. `result_file` holds the Codex
/// last-message file when present.
pub fn parse_output(agent: Agent, stdout: &str, result_file: Option<&str>) -> Result<AgentReview> {
    let value = match agent {
        Agent::Claude => {
            let envelope: Value = serde_json::from_str(stdout.trim())
                .context("claude did not print a JSON result")?;
            if let Some(structured) = envelope.get("structured_output") {
                structured.clone()
            } else {
                let detail = envelope
                    .get("result")
                    .and_then(Value::as_str)
                    .unwrap_or("no structured_output");
                bail!("claude returned no structured output: {}", short(detail));
            }
        }
        Agent::Codex => {
            let text = result_file
                .filter(|t| !t.trim().is_empty())
                .ok_or_else(|| anyhow!("codex wrote no final message"))?;
            extract_json_object(text).context("codex final message has no JSON object")?
        }
        Agent::OpenCode => {
            let mut text = String::new();
            for line in stdout.lines() {
                let Ok(event) = serde_json::from_str::<Value>(line) else {
                    continue;
                };
                match event.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        if let Some(t) = event.pointer("/part/text").and_then(Value::as_str) {
                            text.push_str(t);
                            text.push('\n');
                        }
                    }
                    Some("error") => {
                        let message = event
                            .pointer("/error/message")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown error");
                        bail!("opencode error: {}", short(message));
                    }
                    _ => {}
                }
            }
            extract_json_object(&text).context("opencode output has no JSON object")?
        }
    };
    serde_json::from_value(value).context("agent JSON does not match the review schema")
}

fn short(text: &str) -> String {
    text.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths() -> Paths {
        Paths {
            repo: "/repo".into(),
            input: "/input".into(),
            output: "/output".into(),
        }
    }

    #[test]
    fn commands_are_read_only() {
        let (claude, _) = command(Agent::Claude, Some("sonnet"), &paths(), false);
        let joined = claude.join(" ");
        assert!(joined.contains("--bare"));
        assert!(joined.contains("--tools Read,Grep,Glob"));
        assert!(joined.contains("--restricted"));
        assert!(joined.ends_with("--model sonnet"));
        assert!(!joined.contains("skip-permissions"));

        let (subscription, _) = command(Agent::Claude, None, &paths(), true);
        assert!(subscription.iter().any(|arg| arg == "--safe-mode"));
        assert!(!subscription.iter().any(|arg| arg == "--bare"));
        assert!(subscription.iter().any(|arg| arg == "--restricted"));

        let (codex, _) = command(Agent::Codex, None, &paths(), false);
        assert!(codex.windows(2).any(|w| w == ["--sandbox", "read-only"]));
        assert_eq!(codex.last().unwrap(), "-");

        let (opencode, env) = command(Agent::OpenCode, None, &paths(), false);
        assert!(opencode.iter().any(|arg| arg == "--pure"));
        let config: Value = serde_json::from_str(&env[0].1).unwrap();
        assert_eq!(config["permission"]["*"], "deny");
        assert_eq!(config["permission"]["edit"], Value::Null);
        for name in [
            "OPENCODE_DISABLE_PROJECT_CONFIG",
            "OPENCODE_DISABLE_CLAUDE_CODE",
            "OPENCODE_DISABLE_EXTERNAL_SKILLS",
        ] {
            assert!(
                env.iter()
                    .any(|(key, value)| key == name && value == "true")
            );
        }
    }

    #[test]
    fn model_names() {
        assert!(valid_model("claude-sonnet-5-5[1m]"));
        assert!(valid_model("openrouter/anthropic/claude-sonnet"));
        assert!(!valid_model("--dangerously-skip-permissions"));
        assert!(!valid_model("a b"));
        assert!(!valid_model(""));
    }

    #[test]
    fn parses_claude_envelope() {
        let out =
            r#"{"type":"result","result":"","structured_output":{"summary":"s","findings":[]}}"#;
        assert_eq!(parse_output(Agent::Claude, out, None).unwrap().summary, "s");
        let refused = r#"{"type":"result","is_error":true,"result":"Not logged in"}"#;
        let err = parse_output(Agent::Claude, refused, None).unwrap_err();
        assert!(err.to_string().contains("Not logged in"));
    }

    #[test]
    fn parses_codex_last_message() {
        let review = parse_output(
            Agent::Codex,
            "",
            Some("{\"summary\":\"c\",\"findings\":[]}"),
        )
        .unwrap();
        assert_eq!(review.summary, "c");
        assert!(parse_output(Agent::Codex, "", None).is_err());
    }

    #[test]
    fn parses_opencode_events() {
        let out = concat!(
            r#"{"type":"step_start","part":{}}"#,
            "\n",
            r#"{"type":"text","part":{"type":"text","text":"```json\n{\"summary\":\"o\",\"findings\":[]}\n```"}}"#,
            "\n"
        );
        assert_eq!(
            parse_output(Agent::OpenCode, out, None).unwrap().summary,
            "o"
        );
        let err = r#"{"type":"error","error":{"type":"x","message":"Free usage limit reached"}}"#;
        assert!(
            parse_output(Agent::OpenCode, err, None)
                .unwrap_err()
                .to_string()
                .contains("limit")
        );
    }
}
