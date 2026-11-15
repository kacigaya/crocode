use std::path::Path;
use std::time::Instant;

use anyhow::{Context, Result, anyhow};
use crocode_core::finding::AgentReview;
use tokio_util::sync::CancellationToken;

use crate::agents::{self, Agent, OSV_FILE, OSV_SERVER, RESULT_FILE, SCHEMA_FILE};
use crate::review::redact;
use crate::sandbox::{self, RunError};
use crate::settings::Settings;

pub struct Request<'a> {
    pub agent: Agent,
    pub model: Option<&'a str>,
    pub work_dir: &'a Path,
    pub name: String,
    pub prompt: String,
    pub secrets: Vec<String>,
}

pub struct Attempt {
    pub review: Result<AgentReview>,
    pub usage: agents::Usage,
    pub telemetry: agents::Telemetry,
    pub duration_ms: i64,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

pub async fn run(
    settings: &Settings,
    request: Request<'_>,
    cancel: &CancellationToken,
) -> Result<Attempt, RunError> {
    let input = request.work_dir.join("input");
    let output_dir = request.work_dir.join("output");
    tokio::fs::write(
        input.join(SCHEMA_FILE),
        crocode_core::prompt::output_schema().to_string(),
    )
    .await
    .context("write schema")?;
    tokio::fs::write(input.join(OSV_FILE), OSV_SERVER)
        .await
        .context("write OSV tools")?;
    let paths = sandbox::paths(settings, request.work_dir);
    let (argv, env) = agents::command(
        request.agent,
        request.model,
        &paths,
        agents::claude_uses_subscription(),
    );
    let passthrough: Vec<String> = request
        .agent
        .env_names()
        .iter()
        .map(|s| s.to_string())
        .chain(settings.agent_env.iter().cloned())
        .collect();
    let mut secrets = request.secrets;
    secrets.extend(
        passthrough
            .iter()
            .filter_map(|name| std::env::var(name).ok()),
    );
    if request.agent == Agent::Codex {
        secrets.extend(sandbox::codex_auth_secrets(settings).await?);
    }
    let started = Instant::now();
    let output = sandbox::run(
        settings,
        sandbox::Job {
            name: request.name,
            repo_dir: &request.work_dir.join("repo"),
            input_dir: &input,
            output_dir: &output_dir,
            argv,
            env,
            passthrough,
            stdin: request.prompt,
            codex_auth: request.agent == Agent::Codex,
            offline: false,
        },
        cancel,
    )
    .await?;
    let duration_ms = started.elapsed().as_millis().try_into().unwrap_or(i64::MAX);
    if request.agent == Agent::Codex {
        secrets.extend(sandbox::codex_auth_secrets(settings).await?);
    }
    let stdout = redact(&output.stdout, &secrets);
    let stderr = redact(&output.stderr, &secrets);
    let result_file = tokio::fs::read_to_string(output_dir.join(RESULT_FILE))
        .await
        .ok()
        .map(|text| redact(&text, &secrets));
    let review = parse_review(
        request.agent,
        output.success,
        &stdout,
        result_file.as_deref(),
    );
    Ok(Attempt {
        review,
        usage: agents::parse_usage(request.agent, &stdout),
        telemetry: agents::parse_telemetry(request.agent, &stdout),
        duration_ms,
        stdout,
        stderr,
        success: output.success,
    })
}

fn parse_review(
    agent: Agent,
    success: bool,
    stdout: &str,
    result_file: Option<&str>,
) -> Result<AgentReview> {
    match (success, agents::parse_output(agent, stdout, result_file)) {
        (true, review) => review,
        (false, Err(error)) => Err(error.context("agent process exited unsuccessfully")),
        (false, Ok(_)) => Err(anyhow!("agent process exited unsuccessfully")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_process_preserves_provider_error_but_never_publishes_partial_json() {
        let error = parse_review(
            Agent::Codex,
            false,
            r#"{"type":"turn.failed","error":{"message":"provider unavailable"}}"#,
            None,
        )
        .unwrap_err();
        assert!(format!("{error:#}").contains("provider unavailable"));
        let partial = r#"{"structured_output":{"summary":"partial","findings":[]}}"#;
        assert!(parse_review(Agent::Claude, false, partial, None).is_err());
        assert!(parse_review(Agent::Claude, true, partial, None).is_ok());
    }
}
