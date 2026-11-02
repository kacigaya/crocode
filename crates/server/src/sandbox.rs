//! Runs one agent process, in a locked-down container or on the host.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::agents::Paths;
use crate::settings::{SandboxMode, Settings};

const MAX_STDOUT: usize = 8 * 1024 * 1024;
const MAX_STDERR: usize = 64 * 1024;

/// Container paths. The worker mounts the job directories here.
pub const CONTAINER_PATHS: (&str, &str, &str) = ("/repo", "/input", "/output");

pub struct Job<'a> {
    /// Unique per run. Used as the container name.
    pub name: String,
    pub repo_dir: &'a Path,
    pub input_dir: &'a Path,
    pub output_dir: &'a Path,
    pub argv: Vec<String>,
    /// Fixed values, such as agent config. Not secret.
    pub env: Vec<(String, String)>,
    /// Names of variables copied from the worker environment.
    pub passthrough: Vec<String>,
    pub stdin: String,
}

#[derive(Debug)]
pub struct Output {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error("agent timed out after {0:?}")]
    Timeout(Duration),
    #[error("agent run cancelled")]
    Cancelled,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub fn paths(settings: &Settings, job_dir: &Path) -> Paths {
    match settings.sandbox {
        SandboxMode::Docker => Paths {
            repo: CONTAINER_PATHS.0.into(),
            input: CONTAINER_PATHS.1.into(),
            output: CONTAINER_PATHS.2.into(),
        },
        SandboxMode::None => {
            let s = |p: PathBuf| p.to_string_lossy().into_owned();
            Paths {
                repo: s(job_dir.join("repo")),
                input: s(job_dir.join("input")),
                output: s(job_dir.join("output")),
            }
        }
    }
}

pub async fn run(
    settings: &Settings,
    job: Job<'_>,
    cancel: &CancellationToken,
) -> Result<Output, RunError> {
    let mut command = match settings.sandbox {
        SandboxMode::Docker => docker_command(settings, &job),
        SandboxMode::None => host_command(&job)?,
    };
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command.spawn().context("start agent process")?;
    let mut stdin = child.stdin.take().context("agent stdin")?;
    let stdout = child.stdout.take().context("agent stdout")?;
    let stderr = child.stderr.take().context("agent stderr")?;

    let input = job.stdin;
    let writer = tokio::spawn(async move {
        // The agent may exit before reading everything; ignore broken pipes.
        let _ = stdin.write_all(input.as_bytes()).await;
        let _ = stdin.shutdown().await;
    });
    let out_reader = tokio::spawn(read_capped(stdout, MAX_STDOUT));
    let err_reader = tokio::spawn(read_capped(stderr, MAX_STDERR));

    let status = tokio::select! {
        status = child.wait() => status.context("wait for agent")?,
        _ = tokio::time::sleep(settings.agent_timeout) => {
            stop(settings, &job.name, &mut child).await;
            return Err(RunError::Timeout(settings.agent_timeout));
        }
        _ = cancel.cancelled() => {
            stop(settings, &job.name, &mut child).await;
            return Err(RunError::Cancelled);
        }
    };
    let _ = writer.await;
    let stdout = out_reader.await.context("read stdout")??;
    let stderr = err_reader.await.context("read stderr")??;
    Ok(Output {
        stdout,
        stderr,
        success: status.success(),
    })
}

/// Builds `docker run` for one agent run.
///
/// The container gets a read-only root and repository, no capabilities, no
/// privilege escalation, resource limits, and a non-root user. Secrets pass as
/// `-e NAME` so their values never appear on a command line.
fn docker_command(settings: &Settings, job: &Job<'_>) -> Command {
    let mut c = Command::new("docker");
    c.args(["run", "--rm", "-i", "--name", &job.name]);
    c.args(["--network", &settings.sandbox_network]);
    if let Some(runtime) = &settings.sandbox_runtime {
        c.args(["--runtime", runtime]);
    }
    c.args([
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=512",
        "--memory=4g",
        "--cpus=2",
        "--user=10001:10001",
        "--tmpfs=/tmp:rw,nosuid,nodev,size=512m",
        "--tmpfs=/home/agent:rw,nosuid,nodev,size=512m,uid=10001,gid=10001",
        "--env=HOME=/home/agent",
        "--workdir",
        CONTAINER_PATHS.0,
    ]);
    c.arg(format!(
        "--volume={}:{}:ro",
        job.repo_dir.display(),
        CONTAINER_PATHS.0
    ));
    c.arg(format!(
        "--volume={}:{}:ro",
        job.input_dir.display(),
        CONTAINER_PATHS.1
    ));
    c.arg(format!(
        "--volume={}:{}:rw",
        job.output_dir.display(),
        CONTAINER_PATHS.2
    ));
    if job.argv.first().is_some_and(|program| program == "codex")
        && let Some(directory) = &settings.codex_auth_dir
    {
        c.arg(format!(
            "--volume={}:/home/agent/.codex:rw",
            directory.display()
        ));
    }
    for (key, value) in &job.env {
        c.arg(format!("--env={key}={value}"));
    }
    for name in &job.passthrough {
        if std::env::var_os(name).is_some() {
            c.arg(format!("--env={name}"));
        }
    }
    c.arg(&settings.sandbox_image);
    c.args(&job.argv);
    c
}

/// Read only the dedicated Codex credential store, without exposing host config.
/// Reading through Docker also works after Codex refreshes a file as uid 10001.
pub async fn codex_auth_secrets(settings: &Settings) -> anyhow::Result<Vec<String>> {
    let Some(directory) = &settings.codex_auth_dir else {
        return Ok(Vec::new());
    };
    if settings.sandbox != SandboxMode::Docker {
        bail!("CROCODE_CODEX_AUTH_DIR requires the Docker sandbox");
    }
    let name = format!("crocode-auth-{}", uuid::Uuid::new_v4().simple());
    let mut command = Command::new("docker");
    command.args([
        "run",
        "--name",
        &name,
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user=10001:10001",
    ]);
    if let Some(runtime) = &settings.sandbox_runtime {
        command.args(["--runtime", runtime]);
    }
    command.arg(format!("--volume={}:/auth:ro", directory.display()));
    command.args([&settings.sandbox_image, "cat", "/auth/auth.json"]);
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().context("start Codex credential reader")?;
    let stdout = child.stdout.take().context("credential reader stdout")?;
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        let bytes = read_capped(stdout, 65537).await?;
        let status = child.wait().await?;
        Ok::<_, anyhow::Error>((status, bytes))
    })
    .await;
    let (status, bytes) = match result {
        Ok(Ok(output)) => output,
        _ => {
            stop(settings, &name, &mut child).await;
            bail!("Codex credential read failed or timed out");
        }
    };
    if !status.success() || bytes.len() > 65536 {
        bail!("cannot read Codex credentials from CROCODE_CODEX_AUTH_DIR");
    }
    // Do not include a JSON parse error: it can contain credential bytes.
    let value: serde_json::Value = serde_json::from_str(&bytes)
        .map_err(|_| anyhow::anyhow!("invalid Codex credential store"))?;
    Ok(auth_tokens(&value))
}

fn auth_tokens(value: &serde_json::Value) -> Vec<String> {
    let mut tokens = Vec::new();
    if let Some(object) = value.as_object() {
        for (key, value) in object {
            if matches!(
                key.as_str(),
                "access_token" | "refresh_token" | "id_token" | "OPENAI_API_KEY"
            ) {
                tokens.extend(value.as_str().map(str::to_owned));
            } else if value.is_object() {
                tokens.extend(auth_tokens(value));
            }
        }
    }
    tokens
}

/// Host mode for development. The process gets a clean environment.
fn host_command(job: &Job<'_>) -> Result<Command> {
    let Some((program, args)) = job.argv.split_first() else {
        bail!("empty agent command");
    };
    let mut c = Command::new(program);
    c.args(args).current_dir(job.repo_dir).env_clear();
    for name in ["PATH", "HOME", "USER", "LANG", "TMPDIR"]
        .into_iter()
        .map(String::from)
        .chain(job.passthrough.iter().cloned())
    {
        if let Some(value) = std::env::var_os(&name) {
            c.env(name, value);
        }
    }
    for (key, value) in &job.env {
        c.env(key, value);
    }
    Ok(c)
}

async fn stop(settings: &Settings, name: &str, child: &mut tokio::process::Child) {
    if settings.sandbox == SandboxMode::Docker {
        // Killing the docker CLI does not always stop the container.
        let _ = Command::new("docker")
            .args(["kill", name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
    let _ = child.kill().await;
}

/// Reads at most `max` bytes and drains the rest so the child never blocks.
async fn read_capped(mut reader: impl AsyncRead + Unpin, max: usize) -> Result<String> {
    let mut kept = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        let room = max.saturating_sub(kept.len());
        kept.extend_from_slice(&buf[..n.min(room)]);
    }
    Ok(String::from_utf8_lossy(&kept).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_auth_mount_is_not_shared_with_other_agents() {
        let mut settings = Settings::for_test();
        settings.codex_auth_dir = Some("/private/codex-auth".into());
        for program in ["codex", "claude", "opencode"] {
            let job = Job {
                name: "test".into(),
                repo_dir: Path::new("/repo"),
                input_dir: Path::new("/input"),
                output_dir: Path::new("/output"),
                argv: vec![program.into()],
                env: Vec::new(),
                passthrough: Vec::new(),
                stdin: String::new(),
            };
            let command = docker_command(&settings, &job);
            let args: Vec<_> = command
                .as_std()
                .get_args()
                .map(|s| s.to_string_lossy())
                .collect();
            assert_eq!(
                args.iter().any(|s| s.contains("/private/codex-auth")),
                program == "codex"
            );
            assert!(args.iter().any(|s| s == "--read-only"));
            assert!(args.iter().any(|s| s == "--security-opt=no-new-privileges"));
        }
    }

    #[test]
    fn subscription_tokens_are_collected_for_redaction() {
        let value = serde_json::json!({
            "OPENAI_API_KEY": null,
            "tokens": {"access_token": "access-secret", "refresh_token": "refresh-secret", "id_token": "id-secret", "account_id": "account"},
            "last_refresh": "date",
        });
        let tokens = auth_tokens(&value);
        assert_eq!(tokens.len(), 3);
        for token in ["access-secret", "refresh-secret", "id-secret"] {
            assert!(tokens.contains(&token.to_owned()));
        }
        assert!(!tokens.contains(&"account".to_owned()));
    }

    #[tokio::test]
    async fn caps_output() {
        let data = [b'a'; 100];
        let out = read_capped(&data[..], 10).await.unwrap();
        assert_eq!(out.len(), 10);
    }
}
