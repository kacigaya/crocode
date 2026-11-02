//! Detects the models that each agent CLI offers.
//!
//! The worker runs a list command in the sandbox and stores the result. The
//! dashboard shows the models as suggestions. Settings still accept any valid
//! model name, so a model that a CLI does not list stays usable.
//!
//! - Claude Code has no list command. Its `--model` help names the aliases.
//!   With Anthropic credentials, the Models API adds versioned IDs and names.
//! - Codex prints its model catalog with `codex debug models`.
//! - OpenCode prints `provider/model` lines with `opencode models`.

use std::collections::HashSet;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::agents::{Agent, valid_model};
use crate::review::WorkDir;
use crate::sandbox::{self, RunError};
use crate::{AppState, db};

/// How often the worker refreshes the lists.
const REFRESH: Duration = Duration::from_secs(6 * 60 * 60);
const LIST_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_MODELS: usize = 300;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub name: String,
}

/// Prints `{"help": <claude --help>, "models": <Models API data>}`. The API
/// call needs Anthropic credentials and is skipped for Bedrock and Vertex.
/// An API key wins over a subscription token, like the Claude CLI.
const CLAUDE_LIST_SCRIPT: &str = r#"
import { execFileSync } from "node:child_process";
const env = process.env;
const out = { help: "", models: [] };
try {
  out.help = execFileSync("claude", ["--help"], { encoding: "utf8", timeout: 60000 });
} catch {}
const key = env.ANTHROPIC_API_KEY;
const oauth = env.CLAUDE_CODE_OAUTH_TOKEN;
if ((key || oauth) && !env.CLAUDE_CODE_USE_BEDROCK && !env.CLAUDE_CODE_USE_VERTEX) {
  const base = (env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const headers = key
    ? { "anthropic-version": "2023-06-01", "x-api-key": key }
    : { "anthropic-version": "2023-06-01", authorization: `Bearer ${oauth}`,
        "anthropic-beta": "oauth-2025-04-20" };
  try {
    const res = await fetch(`${base}/v1/models?limit=100`,
      { headers, redirect: "error", signal: AbortSignal.timeout(30000) });
    if (res.ok) out.models = (await res.json()).data ?? [];
  } catch {}
}
console.log(JSON.stringify(out));
"#;

pub fn list_command(agent: Agent) -> Vec<String> {
    let argv: &[&str] = match agent {
        Agent::Claude => &["node", "--input-type=module", "-e", CLAUDE_LIST_SCRIPT],
        Agent::Codex => &["codex", "debug", "models"],
        Agent::OpenCode => &["opencode", "models", "--pure"],
    };
    argv.iter().map(|s| s.to_string()).collect()
}

/// Parses list output. Drops names that the agent command line would reject.
pub fn parse(agent: Agent, stdout: &str) -> Vec<Model> {
    let found: Vec<(String, Option<String>)> = match agent {
        Agent::Claude => claude_models(stdout),
        Agent::Codex => codex_catalog(stdout),
        Agent::OpenCode => stdout
            .lines()
            .map(str::trim)
            .filter(|line| line.contains('/'))
            .map(|line| (line.to_owned(), None))
            .collect(),
    };
    let mut seen = HashSet::new();
    found
        .into_iter()
        .filter(|(id, _)| valid_model(id) && seen.insert(id.clone()))
        .take(MAX_MODELS)
        .map(|(id, name)| Model {
            name: name
                .map(|n| n.trim().to_owned())
                .filter(|n| !n.is_empty() && n.len() <= 100 && !n.chars().any(char::is_control))
                .unwrap_or_else(|| id.clone()),
            id,
        })
        .collect()
}

/// Quoted names in the `--model` help text, up to the next option.
fn claude_aliases(help: &str) -> Vec<String> {
    let mut lines = help
        .lines()
        .skip_while(|l| !l.trim_start().starts_with("--model "));
    let Some(first) = lines.next() else {
        return Vec::new();
    };
    let text: String = std::iter::once(first)
        .chain(lines.take_while(|l| !l.trim_start().starts_with('-')))
        .collect::<Vec<_>>()
        .join(" ");
    text.split('\'')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

/// Aliases from the help text first, then active models from the Models API.
/// An alias is named after the newest model of its line. Plain help text,
/// without the JSON wrapper, still yields the aliases.
fn claude_models(stdout: &str) -> Vec<(String, Option<String>)> {
    let Ok(value) = serde_json::from_str::<Value>(stdout.trim()) else {
        return claude_aliases(stdout)
            .into_iter()
            .map(|id| (id, None))
            .collect();
    };
    // The API lists the newest models first.
    let models: Vec<&Value> = value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["lifecycle"].as_str().is_none_or(|l| l == "active"))
        .collect();
    let aliases = claude_aliases(value["help"].as_str().unwrap_or_default())
        .into_iter()
        .map(|alias| {
            let newest = models
                .iter()
                .find(|m| m["line"].as_str() == Some(alias.as_str()))
                .and_then(|m| m["display_name"].as_str())
                .map(|name| format!("Latest: {name}"));
            (alias, newest)
        });
    let versions = models.iter().filter_map(|m| {
        let id = m["id"].as_str()?.to_owned();
        Some((id, m["display_name"].as_str().map(str::to_owned)))
    });
    aliases.chain(versions).collect()
}

/// Listed models from the Codex catalog. Hidden models are internal.
fn codex_catalog(stdout: &str) -> Vec<(String, Option<String>)> {
    let Ok(value) = serde_json::from_str::<Value>(stdout.trim()) else {
        return Vec::new();
    };
    value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["visibility"].as_str().is_none_or(|v| v == "list"))
        .filter_map(|m| {
            let id = m["slug"].as_str()?.to_owned();
            Some((id, m["display_name"].as_str().map(str::to_owned)))
        })
        .collect()
}

/// Runs one list command in the sandbox.
async fn detect(state: &AppState, agent: Agent, cancel: &CancellationToken) -> Result<Vec<Model>> {
    let mut settings = (*state.settings).clone();
    settings.agent_timeout = LIST_TIMEOUT;
    let name = format!("crocode-models-{}", uuid::Uuid::new_v4().simple());
    let work = WorkDir::create(&settings.work_dir, &name).await?;
    let dirs = ["repo", "input", "output"].map(|d| work.path.join(d));
    for dir in &dirs {
        tokio::fs::create_dir_all(dir)
            .await
            .context("create list dir")?;
    }
    // Claude and OpenCode list more models when they see provider keys. Codex
    // gets no credentials and no auth store.
    let passthrough: Vec<String> = if agent != Agent::Codex {
        agent
            .env_names()
            .iter()
            .map(|s| s.to_string())
            .chain(settings.agent_env.iter().cloned())
            .collect()
    } else {
        Vec::new()
    };
    let output = sandbox::run(
        &settings,
        sandbox::Job {
            name,
            repo_dir: &dirs[0],
            input_dir: &dirs[1],
            output_dir: &dirs[2],
            argv: list_command(agent),
            env: Vec::new(),
            passthrough: passthrough.clone(),
            stdin: String::new(),
            codex_auth: false,
        },
        cancel,
    )
    .await
    .map_err(|err| match err {
        RunError::Other(err) => err,
        other => anyhow::anyhow!(other),
    })?;
    if !output.success {
        bail!("{} model list command failed", agent.name());
    }
    // A model ID must never carry a credential into the database.
    let secrets: Vec<String> = passthrough
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .filter(|value| value.len() >= 8)
        .collect();
    Ok(parse(agent, &output.stdout)
        .into_iter()
        .filter(|m| !secrets.iter().any(|s| m.id.contains(s.as_str())))
        .collect())
}

/// Refreshes the model lists at start and then every few hours.
pub async fn refresh_loop(state: AppState, shutdown: CancellationToken) {
    loop {
        for &agent in &state.settings.agents {
            if shutdown.is_cancelled() {
                return;
            }
            match detect(&state, agent, &shutdown).await {
                Ok(models) if models.is_empty() => {
                    warn!(agent = agent.name(), "agent listed no models")
                }
                Ok(models) => {
                    let count = models.len();
                    match db::save_agent_models(&state.db, agent.name(), &models).await {
                        Ok(()) => info!(agent = agent.name(), count, "agent models detected"),
                        Err(err) => warn!(error = %err, "save agent models"),
                    }
                }
                Err(err) => {
                    warn!(agent = agent.name(), error = %format!("{err:#}"), "detect agent models")
                }
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(REFRESH) => {}
            _ = shutdown.cancelled() => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_aliases_come_from_model_help() {
        let help = "Options:
  --fallback-model <model>   Enable 'nope' fallback
  --model <model>            Model for the current session. Provide
                             an alias for the latest model (e.g.
                             'fable', 'opus', or 'sonnet') or a
                             model's full name.
  -n, --name <name>          Set a 'display' name";
        let ids: Vec<String> = parse(Agent::Claude, help)
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(ids, ["fable", "opus", "sonnet"]);
        assert!(parse(Agent::Claude, "no options").is_empty());
    }

    #[test]
    fn claude_models_api_adds_versions_and_names_aliases() {
        let help = "  --model <model>  Provide an alias ('opus' or 'sonnet') or a full name.";
        let out = json!({"help": help, "models": [
            {"id": "claude-opus-5-5", "display_name": "Claude Opus 5.5", "line": "opus", "lifecycle": "active"},
            {"id": "claude-opus-5", "display_name": "Claude Opus 5", "line": "opus"},
            {"id": "claude-sonnet-4-5", "display_name": "Old", "line": "sonnet", "lifecycle": "deprecated"},
            {"id": "--bad", "display_name": "Flag", "line": "opus"}
        ]});
        let found: Vec<(String, String)> = parse(Agent::Claude, &out.to_string())
            .into_iter()
            .map(|m| (m.id, m.name))
            .collect();
        let pairs = |list: &[(&str, &str)]| -> Vec<(String, String)> {
            list.iter()
                .map(|(a, b)| (a.to_string(), b.to_string()))
                .collect()
        };
        assert_eq!(
            found,
            pairs(&[
                ("opus", "Latest: Claude Opus 5.5"),
                ("sonnet", "sonnet"),
                ("claude-opus-5-5", "Claude Opus 5.5"),
                ("claude-opus-5", "Claude Opus 5"),
            ])
        );
        // No credentials: the API part is empty and the aliases stay.
        let ids: Vec<String> = parse(
            Agent::Claude,
            &json!({"help": help, "models": []}).to_string(),
        )
        .into_iter()
        .map(|m| m.id)
        .collect();
        assert_eq!(ids, ["opus", "sonnet"]);
    }

    #[test]
    fn codex_catalog_keeps_listed_models() {
        let out = r#"{"models":[
            {"slug":"gpt-6","display_name":"GPT-6","visibility":"list"},
            {"slug":"internal","display_name":"Hidden","visibility":"hide"},
            {"slug":"--bad","display_name":"Flag","visibility":"list"},
            {"slug":"gpt-6","display_name":"Duplicate","visibility":"list"}]}"#;
        assert_eq!(
            parse(Agent::Codex, out),
            [Model {
                id: "gpt-6".into(),
                name: "GPT-6".into()
            }]
        );
        assert!(parse(Agent::Codex, "not json").is_empty());
    }

    #[test]
    fn opencode_lines_are_provider_models() {
        let out = "anthropic/claude-sonnet\nINFO starting\n\nopenrouter/x/y\nbad name/x\n";
        let ids: Vec<String> = parse(Agent::OpenCode, out)
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(ids, ["anthropic/claude-sonnet", "openrouter/x/y"]);
    }
}
