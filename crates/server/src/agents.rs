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

pub const OSV_FILE: &str = "osv.mjs";
pub const OSV_SERVER: &str = include_str!("osv.mjs");

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
                    "Read,Grep,Glob,mcp__osv__query,mcp__osv__get_vulnerability",
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
            // Safe mode ignores explicit MCP config in the pinned Claude CLI.
            // Keep it enabled for subscription auth; never weaken startup controls.
            argv.extend([
                "--mcp-config".into(),
                serde_json::json!({"mcpServers": {"osv": {
                    "command": "node", "args": [format!("{}/{OSV_FILE}", paths.input)]
                }}})
                .to_string(),
            ]);
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
                    // JSONL events on stdout carry token usage and errors.
                    "--json",
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
            argv.extend([
                "-c".into(),
                "mcp_servers.osv.command=\"node\"".into(),
                "-c".into(),
                format!(
                    "mcp_servers.osv.args={}",
                    serde_json::json!([format!("{}/{OSV_FILE}", paths.input)])
                ),
            ]);
            argv.push("-".into());
        }
        Agent::OpenCode => {
            // Project plugins and MCP commands run before tool permissions apply.
            argv.extend(["opencode", "run", "--pure", "--format", "json"].map(String::from));
            if let Some(model) = model {
                argv.extend(["--model".into(), model.into()]);
            }
            let mut config: Value =
                serde_json::from_str(OPENCODE_CONFIG).expect("fixed OpenCode config is valid JSON");
            config["mcp"] = serde_json::json!({"osv": {
                "type": "local", "command": ["node", &format!("{}/{OSV_FILE}", paths.input)],
                "enabled": true,
            }});
            config["permission"]["osv_query"] = "allow".into();
            config["permission"]["osv_get_vulnerability"] = "allow".into();
            env.push(("OPENCODE_CONFIG_CONTENT".into(), config.to_string()));
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
            let text =
                result_file
                    .filter(|t| !t.trim().is_empty())
                    .ok_or_else(|| match codex_error(stdout) {
                        Some(message) => anyhow!("codex error: {}", short(&message)),
                        None => anyhow!("codex wrote no final message"),
                    })?;
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

/// The last error message in Codex JSONL events.
fn codex_error(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|event| match event["type"].as_str()? {
            "error" => event["message"].as_str().map(str::to_owned),
            "turn.failed" => event.pointer("/error/message")?.as_str().map(str::to_owned),
            _ => None,
        })
        .next_back()
}

/// Token usage that an agent CLI reports. Input counts include cached input.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Usage {
    pub input_tokens: Option<i64>,
    pub cached_input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    /// The model that used the most tokens, when the CLI names it.
    pub model: Option<String>,
}

impl Usage {
    fn sum_opt(a: Option<i64>, b: Option<i64>) -> Option<i64> {
        match (a, b) {
            (None, None) => None,
            (a, b) => Some(a.unwrap_or(0).saturating_add(b.unwrap_or(0))),
        }
    }

    /// Adds another run, such as a fallback agent run.
    pub fn add(&mut self, other: Usage) {
        self.input_tokens = Self::sum_opt(self.input_tokens, other.input_tokens);
        self.cached_input_tokens =
            Self::sum_opt(self.cached_input_tokens, other.cached_input_tokens);
        self.output_tokens = Self::sum_opt(self.output_tokens, other.output_tokens);
        if other.model.is_some() {
            self.model = other.model;
        }
    }
}

fn tokens(value: &Value, pointer: &str) -> Option<i64> {
    value.pointer(pointer)?.as_i64().filter(|n| *n >= 0)
}

/// Reads token usage from agent stdout. Fields the CLI does not report stay
/// `None`. Formats:
/// - Claude: `modelUsage` per model, or `usage`, in the result envelope.
/// - Codex: `usage` of each `turn.completed` event. Input includes cached input.
/// - OpenCode: `part.tokens` of each `step_finish` event.
pub fn parse_usage(agent: Agent, stdout: &str) -> Usage {
    let mut usage = Usage::default();
    match agent {
        Agent::Claude => {
            let Ok(envelope) = serde_json::from_str::<Value>(stdout.trim()) else {
                return usage;
            };
            if let Some(models) = envelope["modelUsage"].as_object().filter(|m| !m.is_empty()) {
                let mut largest = 0;
                for (model, m) in models {
                    let cached = tokens(m, "/cacheReadInputTokens");
                    let input = [
                        tokens(m, "/inputTokens"),
                        tokens(m, "/cacheCreationInputTokens"),
                    ]
                    .into_iter()
                    .fold(cached, Usage::sum_opt);
                    let output = tokens(m, "/outputTokens");
                    let total = input.unwrap_or(0) + output.unwrap_or(0);
                    usage.add(Usage {
                        input_tokens: input,
                        cached_input_tokens: cached,
                        output_tokens: output,
                        model: None,
                    });
                    if total >= largest && valid_model(model) {
                        largest = total;
                        usage.model = Some(model.clone());
                    }
                }
            } else if envelope["usage"].is_object() {
                let cached = tokens(&envelope, "/usage/cache_read_input_tokens");
                usage.input_tokens = [
                    tokens(&envelope, "/usage/input_tokens"),
                    tokens(&envelope, "/usage/cache_creation_input_tokens"),
                ]
                .into_iter()
                .fold(cached, Usage::sum_opt);
                usage.cached_input_tokens = cached;
                usage.output_tokens = tokens(&envelope, "/usage/output_tokens");
            }
        }
        Agent::Codex | Agent::OpenCode => {
            for event in stdout
                .lines()
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            {
                let run = match (agent, event["type"].as_str()) {
                    (Agent::Codex, Some("turn.completed")) => Usage {
                        input_tokens: tokens(&event, "/usage/input_tokens"),
                        cached_input_tokens: tokens(&event, "/usage/cached_input_tokens"),
                        output_tokens: tokens(&event, "/usage/output_tokens"),
                        model: None,
                    },
                    (Agent::OpenCode, Some("step_finish")) => {
                        let cached = tokens(&event, "/part/tokens/cache/read");
                        Usage {
                            input_tokens: [
                                tokens(&event, "/part/tokens/input"),
                                tokens(&event, "/part/tokens/cache/write"),
                            ]
                            .into_iter()
                            .fold(cached, Usage::sum_opt),
                            cached_input_tokens: cached,
                            output_tokens: Usage::sum_opt(
                                tokens(&event, "/part/tokens/output"),
                                tokens(&event, "/part/tokens/reasoning"),
                            ),
                            model: None,
                        }
                    }
                    _ => continue,
                };
                usage.add(run);
            }
        }
    }
    usage
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
        assert!(codex.iter().any(|arg| arg == "--json"));
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
    fn agents_configure_only_the_trusted_osv_tools() {
        for subscription in [false, true] {
            let (argv, _) = command(Agent::Claude, None, &paths(), subscription);
            let index = argv.iter().position(|arg| arg == "--mcp-config").unwrap();
            let config: Value = serde_json::from_str(&argv[index + 1]).unwrap();
            assert_eq!(config["mcpServers"]["osv"]["args"][0], "/input/osv.mjs");
            assert_eq!(config["mcpServers"].as_object().unwrap().len(), 1);
            assert!(argv.iter().any(|arg| arg.contains("mcp__osv__query")));
            assert!(argv.iter().any(|arg| arg == "--strict-mcp-config"));
        }
        let (argv, _) = command(Agent::Codex, None, &paths(), false);
        assert!(
            argv.iter()
                .any(|arg| arg == r#"mcp_servers.osv.command="node""#)
        );
        assert!(
            argv.iter()
                .any(|arg| arg == r#"mcp_servers.osv.args=["/input/osv.mjs"]"#)
        );
        let (_, env) = command(Agent::OpenCode, None, &paths(), false);
        let config: Value = serde_json::from_str(&env[0].1).unwrap();
        assert_eq!(
            config["mcp"]["osv"]["command"],
            serde_json::json!(["node", "/input/osv.mjs"])
        );
        assert_eq!(config["permission"]["osv_query"], "allow");
        assert_eq!(config["permission"]["osv_get_vulnerability"], "allow");
        assert_eq!(config["permission"]["*"], "deny");
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
    fn usage_from_each_cli() {
        // Shapes from Claude Code 2.1.310 and Codex 0.166.0 output on 2026-11-02.
        let claude = r#"{"type":"result","usage":{"input_tokens":2,"cache_creation_input_tokens":1250,"cache_read_input_tokens":1670,"output_tokens":4},
            "modelUsage":{"claude-sonnet-5-5":{"inputTokens":2,"outputTokens":4,"cacheReadInputTokens":1670,"cacheCreationInputTokens":1250},
                          "claude-haiku-5-5":{"inputTokens":10,"outputTokens":1}}}"#;
        assert_eq!(
            parse_usage(Agent::Claude, claude),
            Usage {
                input_tokens: Some(2932),
                cached_input_tokens: Some(1670),
                output_tokens: Some(5),
                model: Some("claude-sonnet-5-5".into()),
            }
        );
        let envelope_only =
            r#"{"usage":{"input_tokens":5,"cache_read_input_tokens":3,"output_tokens":7}}"#;
        assert_eq!(
            parse_usage(Agent::Claude, envelope_only),
            Usage {
                input_tokens: Some(8),
                cached_input_tokens: Some(3),
                output_tokens: Some(7),
                model: None,
            }
        );
        let codex = concat!(
            r#"{"type":"thread.started","thread_id":"x"}"#,
            "\n",
            r#"{"type":"turn.completed","usage":{"input_tokens":24388,"cached_input_tokens":12288,"output_tokens":5}}"#,
            "\n",
            r#"{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":1}}"#,
        );
        let usage = parse_usage(Agent::Codex, codex);
        assert_eq!(usage.input_tokens, Some(24400));
        assert_eq!(usage.cached_input_tokens, Some(12288));
        assert_eq!(usage.output_tokens, Some(6));
        let opencode = r#"{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":10,"output":4,"reasoning":2,"cache":{"read":30,"write":5}}}}"#;
        assert_eq!(
            parse_usage(Agent::OpenCode, opencode),
            Usage {
                input_tokens: Some(45),
                cached_input_tokens: Some(30),
                output_tokens: Some(6),
                model: None,
            }
        );
        for agent in [Agent::Claude, Agent::Codex, Agent::OpenCode] {
            assert_eq!(parse_usage(agent, "not json"), Usage::default());
        }
        let mut total = Usage::default();
        total.add(Usage::default());
        assert_eq!(total, Usage::default());
    }

    #[test]
    fn codex_errors_come_from_json_events() {
        let out = r#"{"type":"turn.failed","error":{"message":"You've hit your usage limit"}}"#;
        let err = parse_output(Agent::Codex, out, None).unwrap_err();
        assert!(err.to_string().contains("usage limit"), "{err}");
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
