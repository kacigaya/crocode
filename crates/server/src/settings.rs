//! Server settings from environment variables.

use std::env;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result, bail};

use crate::agents::Agent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxMode {
    /// Each agent run gets its own read-only container.
    Docker,
    /// Runs the agent CLI on the host. For local development only.
    None,
}

#[derive(Clone)]
pub struct Settings {
    pub database_url: String,
    pub bind: String,
    pub github_app_id: u64,
    pub github_private_key: Vec<u8>,
    pub github_webhook_secret: Vec<u8>,
    pub github_api_url: String,
    /// Git host used to fetch pull request heads.
    pub github_web_url: String,
    pub agents: Vec<Agent>,
    pub default_agent: Agent,
    pub sandbox: SandboxMode,
    pub sandbox_image: String,
    pub sandbox_network: String,
    pub sandbox_runtime: Option<String>,
    pub work_dir: PathBuf,
    pub worker_concurrency: usize,
    pub max_per_installation: i64,
    pub agent_timeout: Duration,
    pub max_repo_size_mb: u64,
    /// Extra environment variable names passed to every agent run.
    pub agent_env: Vec<String>,
}

impl std::fmt::Debug for Settings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Keep secrets out of logs.
        f.debug_struct("Settings")
            .field("bind", &self.bind)
            .field("github_app_id", &self.github_app_id)
            .field("github_api_url", &self.github_api_url)
            .field("agents", &self.agents)
            .field("default_agent", &self.default_agent)
            .field("sandbox", &self.sandbox)
            .field("sandbox_image", &self.sandbox_image)
            .field("work_dir", &self.work_dir)
            .field("worker_concurrency", &self.worker_concurrency)
            .finish_non_exhaustive()
    }
}

impl Settings {
    #[cfg(test)]
    pub fn for_test() -> Self {
        Self {
            database_url: "postgres://unused:unused@127.0.0.1:1/unused".into(),
            bind: "127.0.0.1:0".into(),
            github_app_id: 1,
            github_private_key: Vec::new(),
            github_webhook_secret: b"test-webhook-secret".to_vec(),
            github_api_url: "http://127.0.0.1:1".into(),
            github_web_url: "http://127.0.0.1:1".into(),
            agents: vec![Agent::Claude, Agent::Codex, Agent::OpenCode],
            default_agent: Agent::Claude,
            sandbox: SandboxMode::Docker,
            sandbox_image: "crocode-sandbox:test".into(),
            sandbox_network: "none".into(),
            sandbox_runtime: None,
            work_dir: "/unused".into(),
            worker_concurrency: 2,
            max_per_installation: 1,
            agent_timeout: Duration::from_secs(1),
            max_repo_size_mb: 1,
            agent_env: Vec::new(),
        }
    }

    pub fn from_env() -> Result<Self> {
        // Empty counts as unset, like every optional variable, because
        // Compose passes `${VAR:-}` as an empty string.
        let github_private_key = match optional("GITHUB_PRIVATE_KEY_PATH") {
            Some(path) => std::fs::read(&path).with_context(|| format!("read {path}"))?,
            None => required("GITHUB_PRIVATE_KEY")?
                .replace("\\n", "\n")
                .into_bytes(),
        };
        let agents = optional("CROCODE_AGENTS")
            .unwrap_or_else(|| "claude,codex,opencode".into())
            .split(',')
            .map(|name| name.trim().parse())
            .collect::<Result<Vec<Agent>>>()?;
        let default_agent: Agent = optional("CROCODE_DEFAULT_AGENT")
            .unwrap_or_else(|| agents.first().map_or("claude", |a| a.name()).into())
            .parse()?;
        if !agents.contains(&default_agent) {
            bail!("CROCODE_DEFAULT_AGENT must be one of CROCODE_AGENTS");
        }
        let sandbox = match optional("CROCODE_SANDBOX").as_deref() {
            None | Some("docker") => SandboxMode::Docker,
            Some("none") => SandboxMode::None,
            Some(other) => bail!("CROCODE_SANDBOX must be docker or none, got {other:?}"),
        };
        let webhook_secret = required("GITHUB_WEBHOOK_SECRET")?;
        if webhook_secret.len() < 16 {
            bail!("GITHUB_WEBHOOK_SECRET must be at least 16 characters");
        }

        Ok(Self {
            database_url: required("DATABASE_URL")?,
            bind: optional("CROCODE_BIND").unwrap_or_else(|| "0.0.0.0:8080".into()),
            github_app_id: required("GITHUB_APP_ID")?
                .parse()
                .context("GITHUB_APP_ID")?,
            github_private_key,
            github_webhook_secret: webhook_secret.into_bytes(),
            github_api_url: optional("GITHUB_API_URL")
                .unwrap_or_else(|| "https://api.github.com".into()),
            github_web_url: optional("GITHUB_WEB_URL")
                .unwrap_or_else(|| "https://github.com".into())
                .trim_end_matches('/')
                .to_owned(),
            agents,
            default_agent,
            sandbox,
            sandbox_image: optional("CROCODE_SANDBOX_IMAGE")
                .unwrap_or_else(|| "crocode-sandbox:latest".into()),
            sandbox_network: optional("CROCODE_SANDBOX_NETWORK").unwrap_or_else(|| "bridge".into()),
            sandbox_runtime: optional("CROCODE_SANDBOX_RUNTIME"),
            work_dir: optional("CROCODE_WORK_DIR")
                .unwrap_or_else(|| "/var/lib/crocode/work".into())
                .into(),
            worker_concurrency: number("CROCODE_WORKER_CONCURRENCY", 4)?.max(1) as usize,
            max_per_installation: number("CROCODE_MAX_PER_INSTALLATION", 2)?.max(1) as i64,
            agent_timeout: Duration::from_secs(number("CROCODE_AGENT_TIMEOUT_SECS", 900)?),
            max_repo_size_mb: number("CROCODE_MAX_REPO_SIZE_MB", 1024)?,
            agent_env: optional("CROCODE_AGENT_ENV")
                .map(|s| {
                    s.split(',')
                        .map(|v| v.trim().to_owned())
                        .filter(|v| !v.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
        })
    }
}

fn optional(name: &str) -> Option<String> {
    env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn required(name: &str) -> Result<String> {
    optional(name).with_context(|| format!("{name} is required"))
}

fn number(name: &str, default: u64) -> Result<u64> {
    optional(name).map_or(Ok(default), |v| {
        v.parse()
            .with_context(|| format!("{name} must be a number"))
    })
}
