//! One review: fetch, run the agent, validate, publish.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, anyhow};
use crocode_core::config::{CONFIG_PATH, RepoConfig};
use crocode_core::diff::FileDiff;
use crocode_core::finding::{self, Finding, Severity, ValidationOptions};
use crocode_core::prompt::{self, PromptFile};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::agents::{self, Agent, OSV_FILE, OSV_SERVER, RESULT_FILE, SCHEMA_FILE, valid_model};
use crate::github::{NewComment, NewReview, PullFile, RepoClient, status_code};
use crate::sandbox::{self, RunError};
use crate::settings::FallbackAgent;
use crate::{AppState, db};

const GIT_TIMEOUT: Duration = Duration::from_secs(300);
/// Larger patches are not stored for the dashboard diff view.
const MAX_STORED_PATCH: usize = 256 * 1024;

pub enum Outcome {
    Done {
        summary: String,
        agent: Agent,
        model: Option<String>,
    },
    Skipped(String),
}

#[derive(Debug, thiserror::Error)]
pub enum ReviewError {
    #[error("cancelled")]
    Cancelled,
    /// Retrying will not help, such as a bad `.crocode.yml`.
    #[error("{0}")]
    Permanent(String),
    #[error(transparent)]
    Retry(#[from] anyhow::Error),
}

impl From<sqlx::Error> for ReviewError {
    fn from(err: sqlx::Error) -> Self {
        Self::Retry(err.into())
    }
}

fn skip(reason: impl Into<String>) -> Result<Outcome, ReviewError> {
    Ok(Outcome::Skipped(reason.into()))
}

pub async fn execute(
    state: &AppState,
    job: &db::Job,
    cancel: &CancellationToken,
) -> Result<Outcome, ReviewError> {
    let settings = &state.settings;
    let Some(installation) = db::installation(&state.db, job.installation_id).await? else {
        return Err(ReviewError::Permanent("installation not found".into()));
    };
    if installation.suspended || !installation.enabled {
        return skip("reviews are disabled for this installation");
    }

    let gh = state
        .github
        .repo_client(job.installation_id, job.repo_id, &job.repo_full_name)
        .await?;
    let number = i64::from(job.pr_number);
    let pull = gh.pull(number).await?;
    if pull.state != "open" {
        return skip("pull request is closed");
    }
    if pull.head.sha != job.head_sha {
        return skip("a newer commit replaced this one");
    }

    // Config comes from the base commit so the pull request cannot change it.
    let config = match gh.file_text(CONFIG_PATH, &pull.base.sha).await? {
        Some(text) => {
            RepoConfig::parse(&text).map_err(|e| ReviewError::Permanent(e.to_string()))?
        }
        None => RepoConfig::default(),
    };
    if !config.enabled {
        return skip(format!("disabled in {CONFIG_PATH}"));
    }
    if pull.draft == Some(true) && !config.review_drafts {
        return skip("draft pull request");
    }

    // Repository config wins over installation settings, which win over the
    // server default. A repository agent choice also resets the model.
    let (agent_name, model) = match config.agent.as_deref() {
        Some(agent) => (Some(agent), config.model.clone()),
        None => (
            installation.agent.as_deref(),
            config.model.clone().or(installation.model.clone()),
        ),
    };
    let agent = match agent_name {
        Some(name) => name
            .parse::<Agent>()
            .map_err(|e| ReviewError::Permanent(e.to_string()))?,
        None => settings.default_agent,
    };
    if !settings.agents.contains(&agent) {
        return Err(ReviewError::Permanent(format!(
            "agent {} is not enabled on this server",
            agent.name()
        )));
    }
    if model.as_deref().is_some_and(|m| !valid_model(m)) {
        return Err(ReviewError::Permanent("invalid model name".into()));
    }

    let files = gh.files(number, config.max_files).await?;
    if files.len() > config.max_files {
        return skip(format!(
            "too many changed files (more than {})",
            config.max_files
        ));
    }
    let ignore = config
        .ignore_set()
        .map_err(|e| ReviewError::Permanent(e.to_string()))?;
    let reviewed: Vec<&PullFile> = files
        .iter()
        .filter(|f| f.status != "removed" && f.patch.is_some() && !ignore.is_match(&f.filename))
        .filter(|f| finding::normalize_path(&f.filename).is_some())
        .collect();
    if reviewed.is_empty() {
        return skip("no reviewable changes");
    }
    let changed: u64 = reviewed.iter().map(|f| f.additions + f.deletions).sum();
    if changed > config.max_changed_lines as u64 {
        return skip(format!(
            "too many changed lines ({changed} > {})",
            config.max_changed_lines
        ));
    }
    if gh.size_kb().await? > settings.max_repo_size_mb * 1024 {
        return skip("repository is larger than the configured limit");
    }

    let diffs: HashMap<String, FileDiff> = reviewed
        .iter()
        .map(|f| {
            let patch = f.patch.as_deref().unwrap_or_default();
            (f.filename.clone(), FileDiff::parse(&f.filename, patch))
        })
        .collect();

    let work = WorkDir::create(&settings.work_dir, &job.id.to_string()).await?;
    let repo_dir = work.path.join("repo");
    let input_dir = work.path.join("input");
    let output_dir = work.path.join("output");
    for dir in [&input_dir, &output_dir] {
        tokio::fs::create_dir_all(dir)
            .await
            .context("create job dir")?;
    }
    if !checkout(state, &gh, number, &job.head_sha, &repo_dir, cancel).await? {
        return skip("a newer commit replaced this one");
    }
    // The sandbox user must be able to write the output dir.
    set_mode(&output_dir, 0o777).await?;

    let prompt_files: Vec<PromptFile<'_>> = reviewed
        .iter()
        .map(|f| PromptFile {
            path: &f.filename,
            patch: f.patch.as_deref().unwrap_or_default(),
        })
        .collect();
    let boundary = uuid::Uuid::new_v4().simple().to_string();
    let text = prompt::build(
        &prompt::PullRequest {
            repo: &job.repo_full_name,
            number: number as u64,
            title: &pull.title,
            body: pull.body.as_deref().unwrap_or_default(),
            base_ref: &pull.base.name,
            head_sha: &job.head_sha,
        },
        &prompt_files,
        config.instructions.as_deref(),
        &boundary,
    );
    tokio::fs::write(
        input_dir.join(SCHEMA_FILE),
        prompt::output_schema().to_string(),
    )
    .await
    .context("write schema")?;

    tokio::fs::write(input_dir.join(OSV_FILE), OSV_SERVER)
        .await
        .context("write OSV tools")?;

    let paths = sandbox::paths(settings, &work.path);
    let mut agent = agent;
    let mut model = model;
    let mut fallback_used = false;
    let agent_review = loop {
        if cancel.is_cancelled() {
            return Err(ReviewError::Cancelled);
        }
        let (argv, env) = agents::command(
            agent,
            model.as_deref(),
            &paths,
            agents::claude_uses_subscription(),
        );
        let passthrough: Vec<String> = agent
            .env_names()
            .iter()
            .map(|s| s.to_string())
            .chain(settings.agent_env.iter().cloned())
            .collect();
        // Keep token snapshots and refreshes under one lock across workers.
        let _auth_lock = if agent == Agent::Codex {
            if let Some(directory) = &settings.codex_auth_dir {
                Some(lock_codex_auth(&state.db, directory, cancel).await?)
            } else {
                None
            }
        } else {
            None
        };
        let mut codex_secrets = if agent == Agent::Codex {
            sandbox::codex_auth_secrets(settings).await?
        } else {
            Vec::new()
        };
        info!(review = %job.id, agent = agent.name(), "agent started");
        let output = sandbox::run(
            settings,
            sandbox::Job {
                name: format!("crocode-{}", job.id.simple()),
                repo_dir: &repo_dir,
                input_dir: &input_dir,
                output_dir: &output_dir,
                argv,
                env,
                passthrough: passthrough.clone(),
                stdin: text.clone(),
            },
            cancel,
        )
        .await
        .map_err(|err| match err {
            RunError::Cancelled => ReviewError::Cancelled,
            other => ReviewError::Retry(anyhow!(other)),
        })?;

        // Agent output can echo credentials if a prompt injection asks for them.
        // Remove every secret value this worker knows before anything is stored.
        let mut secrets: Vec<String> = passthrough
            .iter()
            .filter_map(|name| std::env::var(name).ok())
            .collect();
        secrets.push(gh.token().to_owned());
        if agent == Agent::Codex {
            codex_secrets.extend(sandbox::codex_auth_secrets(settings).await?);
        }
        secrets.extend(codex_secrets);
        let stdout = redact(&output.stdout, &secrets);
        let result_file = tokio::fs::read_to_string(output_dir.join(RESULT_FILE))
            .await
            .ok()
            .map(|t| redact(&t, &secrets));

        let parsed = agents::parse_output(agent, &stdout, result_file.as_deref());
        match parsed {
            Ok(review) => break review,
            Err(err) => {
                let stderr = redact(&output.stderr, &secrets);
                if let Some(next) = fallback_for_limit(
                    agent,
                    settings.fallback_agent,
                    fallback_used,
                    &stdout,
                    &stderr,
                ) {
                    warn!(review = %job.id, agent = agent.name(), fallback = next.name(),
                        "agent usage limit reached; starting fallback");
                    agent = next;
                    model = None;
                    fallback_used = true;
                    // A partial result from the first agent must not be read by the fallback.
                    match tokio::fs::remove_file(output_dir.join(RESULT_FILE)).await {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(ReviewError::Retry(error.into())),
                    }
                    continue;
                }
                let tail: String = stderr
                    .chars()
                    .rev()
                    .take(500)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                return Err(ReviewError::Retry(anyhow!(
                    "{err:#} (exit ok: {}; stderr: {tail})",
                    output.success
                )));
            }
        }
    };

    let validated = finding::validate(
        agent_review,
        &diffs,
        &ValidationOptions {
            min_severity: config.min_severity,
            max_inline: config.max_comments,
        },
    );
    let seen = db::published_fingerprints(&state.db, job.repo_id, number).await?;
    let (new, repeated): (Vec<Finding>, Vec<Finding>) = validated
        .findings
        .into_iter()
        .partition(|f| !seen.contains(&f.fingerprint));
    info!(
        review = %job.id,
        new = new.len(),
        repeated = repeated.len(),
        dropped = validated.dropped,
        "agent finished"
    );

    // A retry after a crash must not post the same review twice.
    let mut posted = job.github_review_id.is_some();
    if !posted && !new.is_empty() {
        let review_id =
            publish(&gh, number, &job.head_sha, agent, &validated.summary, &new).await?;
        db::set_github_review_id(&state.db, job.id, review_id).await?;
        posted = true;
    }

    let rows: Vec<db::NewFinding<'_>> = new
        .iter()
        .map(|f| (f, posted))
        .chain(repeated.iter().map(|f| (f, false)))
        .map(|(f, published)| db::NewFinding {
            fingerprint: &f.fingerprint,
            path: &f.path,
            start_line: f.start_line,
            line: f.line,
            severity: f.severity.as_str(),
            category: f.category.as_str(),
            title: &f.title,
            body: &f.body,
            suggestion: f.suggestion.as_deref(),
            published,
        })
        .collect();
    let finding_paths: HashSet<&str> = rows.iter().map(|f| f.path).collect();
    let patches: Vec<(&str, &str)> = reviewed
        .iter()
        .filter(|f| finding_paths.contains(f.filename.as_str()))
        .filter_map(|f| Some((f.filename.as_str(), f.patch.as_deref()?)))
        .filter(|(_, patch)| patch.len() <= MAX_STORED_PATCH)
        .collect();
    db::insert_findings(&state.db, job.id, job.repo_id, number, &rows, &patches).await?;

    let summary = if new.is_empty() {
        format!("{}\n\nNo new findings.", validated.summary)
    } else {
        validated.summary
    };
    Ok(Outcome::Done {
        summary,
        agent,
        model,
    })
}

async fn lock_codex_auth<'a>(
    database: &'a db::Db,
    directory: &Path,
    cancel: &CancellationToken,
) -> Result<sqlx::Transaction<'a, sqlx::Postgres>, ReviewError> {
    let mut transaction = database.begin().await?;
    tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(ReviewError::Cancelled),
        result = sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("crocode:codex-auth:{}", directory.display()))
            .execute(&mut *transaction) => { result?; }
    }
    Ok(transaction)
}

fn fallback_for_limit(
    agent: Agent,
    fallback: Option<FallbackAgent>,
    fallback_used: bool,
    stdout: &str,
    stderr: &str,
) -> Option<Agent> {
    if fallback_used {
        return None;
    }
    let fallback = match fallback? {
        FallbackAgent::Fixed(next) if next != agent => next,
        FallbackAgent::Auto => match agent {
            Agent::Claude => Agent::Codex,
            Agent::Codex => Agent::Claude,
            Agent::OpenCode => return None,
        },
        FallbackAgent::Fixed(_) => return None,
    };
    let limited = [stdout, stderr].iter().any(|text| {
        let text = text.to_ascii_lowercase();
        [
            "you've hit your",
            "usage limit",
            "rate limit",
            "rate_limit",
            "insufficient_quota",
        ]
        .iter()
        .any(|marker| text.contains(marker))
    });
    limited.then_some(fallback)
}

async fn publish(
    gh: &RepoClient,
    number: i64,
    head_sha: &str,
    agent: Agent,
    summary: &str,
    findings: &[Finding],
) -> anyhow::Result<i64> {
    let comments: Vec<NewComment> = findings
        .iter()
        .filter(|f| f.inline)
        .map(|f| NewComment {
            path: f.path.clone(),
            line: f.line,
            side: "RIGHT",
            start_line: f.start_line,
            start_side: f.start_line.map(|_| "RIGHT"),
            body: comment_body(f),
        })
        .collect();
    let mut review = NewReview {
        commit_id: head_sha.to_owned(),
        body: review_body(summary, findings, agent, head_sha, false),
        event: "COMMENT",
        comments,
    };
    match gh.create_review(number, &review).await {
        Ok(id) => Ok(id),
        // GitHub rejects the whole review when one line is not in the diff.
        // Fall back to a review that lists every finding in its body.
        Err(err) if status_code(&err) == Some(422) && !review.comments.is_empty() => {
            warn!(error = %err, "inline comments rejected; posting summary only");
            review.comments.clear();
            review.body = review_body(summary, findings, agent, head_sha, true);
            Ok(gh.create_review(number, &review).await?)
        }
        Err(err) => Err(err.into()),
    }
}

fn severity_label(s: Severity) -> &'static str {
    match s {
        Severity::Critical => "🔴 Critical",
        Severity::High => "🟠 High",
        Severity::Medium => "🟡 Medium",
        Severity::Low => "🔵 Low",
        Severity::Info => "⚪ Info",
    }
}

/// Fence that is longer than any backtick run in `text`.
fn fence(text: &str) -> String {
    let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    "`".repeat(longest.max(2) + 1)
}

pub fn comment_body(f: &Finding) -> String {
    let mut body = format!(
        "**{} · {}** — {}\n\n{}",
        severity_label(f.severity),
        f.category.as_str(),
        f.title,
        f.body
    );
    if let Some(suggestion) = &f.suggestion {
        let fence = fence(suggestion);
        body.push_str(&format!(
            "\n\n{fence}suggestion\n{}\n{fence}",
            suggestion.trim_end_matches('\n')
        ));
    }
    body
}

pub fn review_body(
    summary: &str,
    findings: &[Finding],
    agent: Agent,
    head_sha: &str,
    all_in_body: bool,
) -> String {
    let mut body = String::from("### CroCode review\n\n");
    if !summary.trim().is_empty() {
        body.push_str(summary.trim());
        body.push_str("\n\n");
    }
    let mut counts: Vec<(Severity, usize)> = Vec::new();
    for f in findings {
        match counts.iter_mut().find(|(s, _)| *s == f.severity) {
            Some((_, n)) => *n += 1,
            None => counts.push((f.severity, 1)),
        }
    }
    let counts: Vec<String> = counts
        .iter()
        .map(|(s, n)| format!("{} {n}", severity_label(*s)))
        .collect();
    body.push_str(&format!("**Findings:** {}\n", counts.join(" · ")));

    let listed: Vec<&Finding> = findings
        .iter()
        .filter(|f| all_in_body || !f.inline)
        .collect();
    if !listed.is_empty() {
        body.push_str("\nNot posted as inline comments:\n\n");
        for f in listed {
            body.push_str(&format!(
                "- **{}** `{}:{}` {}\n",
                severity_label(f.severity),
                f.path.replace('`', "'"),
                f.line,
                f.title
            ));
        }
    }
    let short_sha: String = head_sha.chars().take(7).collect();
    body.push_str(&format!(
        "\n<sub>Agent: {} · Commit {short_sha}</sub>\n",
        agent.name()
    ));
    body
}

/// Replaces each known secret value with `[redacted]`.
pub fn redact(text: &str, secrets: &[String]) -> String {
    let mut out = text.to_owned();
    for secret in secrets.iter().filter(|s| s.len() >= 8) {
        if out.contains(secret.as_str()) {
            out = out.replace(secret.as_str(), "[redacted]");
        }
    }
    out
}

/// Job directory that is removed when dropped.
struct WorkDir {
    path: PathBuf,
}

impl WorkDir {
    async fn create(root: &Path, name: &str) -> anyhow::Result<Self> {
        let path = root.join(name);
        if tokio::fs::try_exists(&path).await? {
            tokio::fs::remove_dir_all(&path).await?;
        }
        tokio::fs::create_dir_all(&path)
            .await
            .with_context(|| format!("create {}", path.display()))?;
        Ok(Self { path })
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        if let Err(err) = std::fs::remove_dir_all(&self.path) {
            warn!(path = %self.path.display(), error = %err, "remove job dir");
        }
    }
}

async fn set_mode(path: &Path, mode: u32) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).await?;
    Ok(())
}

/// Fetches the pull request head into `dir` without leaving credentials on disk.
///
/// The token goes to git through `GIT_CONFIG_*` variables, not the URL or the
/// command line. Symlinks become plain files so a link cannot point the agent
/// at files outside the repository. `.git` is removed after checkout.
/// Returns false when the head moved to another commit.
async fn checkout(
    state: &AppState,
    gh: &RepoClient,
    number: i64,
    head_sha: &str,
    dir: &Path,
    cancel: &CancellationToken,
) -> Result<bool, ReviewError> {
    use base64::Engine;
    tokio::fs::create_dir_all(dir)
        .await
        .context("create repo dir")?;
    let url = format!("{}/{}.git", state.settings.github_web_url, gh.repo);
    let auth =
        base64::engine::general_purpose::STANDARD.encode(format!("x-access-token:{}", gh.token()));
    let header = format!("AUTHORIZATION: basic {auth}");
    let refspec = format!("+refs/pull/{number}/head:refs/remotes/pr");

    git(dir, &["init", "-q"], None, cancel).await?;
    git(
        dir,
        &[
            "fetch",
            "-q",
            "--depth=1",
            "--no-tags",
            "--no-recurse-submodules",
            &url,
            &refspec,
        ],
        Some(&header),
        cancel,
    )
    .await?;
    git(
        dir,
        &[
            "-c",
            "core.symlinks=false",
            "checkout",
            "-q",
            "--detach",
            "refs/remotes/pr",
        ],
        None,
        cancel,
    )
    .await?;
    let head = git(dir, &["rev-parse", "HEAD"], None, cancel).await?;
    tokio::fs::remove_dir_all(dir.join(".git"))
        .await
        .context("remove .git")?;
    Ok(head.trim() == head_sha)
}

async fn git(
    dir: &Path,
    args: &[&str],
    auth_header: Option<&str>,
    cancel: &CancellationToken,
) -> Result<String, ReviewError> {
    let mut c = Command::new("git");
    c.args(args)
        .current_dir(dir)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(header) = auth_header {
        c.env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "http.extraHeader")
            .env("GIT_CONFIG_VALUE_0", header);
    }
    let output = tokio::select! {
        out = tokio::time::timeout(GIT_TIMEOUT, c.output()) => out
            .map_err(|_| anyhow!("git {} timed out", args[0]))?
            .context("run git")?,
        _ = cancel.cancelled() => return Err(ReviewError::Cancelled),
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("git {} failed: {}", args[0], stderr.trim()).into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crocode_core::finding::Category;

    fn finding(inline: bool, suggestion: Option<&str>) -> Finding {
        Finding {
            path: "src/a.rs".into(),
            start_line: None,
            line: 4,
            severity: Severity::High,
            category: Category::Security,
            title: "SQL built from input".into(),
            body: "Use bind parameters.".into(),
            suggestion: suggestion.map(String::from),
            fingerprint: "f".into(),
            inline,
        }
    }

    #[sqlx::test(migrations = "../../migrations")]
    #[ignore = "needs DATABASE_URL"]
    async fn codex_auth_lock_serializes_shared_logins(pool: sqlx::PgPool) {
        let path = Path::new("/private/codex-auth");
        let cancel = CancellationToken::new();
        let lock = lock_codex_auth(&pool, path, &cancel).await.unwrap();
        let mut waiting = Box::pin(lock_codex_auth(&pool, path, &cancel));
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut waiting)
                .await
                .is_err()
        );
        let other = lock_codex_auth(&pool, Path::new("/private/other-auth"), &cancel)
            .await
            .unwrap();
        other.rollback().await.unwrap();
        lock.rollback().await.unwrap();
        let lock = waiting.await.unwrap();
        let cancelled = CancellationToken::new();
        cancelled.cancel();
        assert!(matches!(
            lock_codex_auth(&pool, path, &cancelled).await,
            Err(ReviewError::Cancelled)
        ));
        lock.rollback().await.unwrap();
    }

    #[test]
    fn fixed_fallback_only_on_usage_limits() {
        let fixed = Some(FallbackAgent::Fixed(Agent::Codex));
        assert_eq!(
            fallback_for_limit(
                Agent::Claude,
                fixed,
                false,
                "You've hit your 5-hour limit · resets 6pm (UTC)",
                ""
            ),
            Some(Agent::Codex)
        );
        assert_eq!(
            fallback_for_limit(
                Agent::Claude,
                fixed,
                false,
                "",
                "HTTP 429: rate_limit_exceeded"
            ),
            Some(Agent::Codex)
        );
        for error in ["invalid JSON", "Not logged in", "connection refused"] {
            assert_eq!(
                fallback_for_limit(Agent::Claude, fixed, false, error, ""),
                None
            );
        }
        assert_eq!(
            fallback_for_limit(Agent::Codex, fixed, false, "usage limit", ""),
            None
        );
        assert_eq!(
            fallback_for_limit(Agent::Claude, None, false, "usage limit", ""),
            None
        );
        assert_eq!(
            fallback_for_limit(Agent::Claude, fixed, true, "usage limit", ""),
            None
        );
    }

    #[test]
    fn automatic_fallback_works_both_ways_without_loops() {
        let auto = Some(FallbackAgent::Auto);
        for (primary, fallback) in [(Agent::Claude, Agent::Codex), (Agent::Codex, Agent::Claude)] {
            assert_eq!(
                fallback_for_limit(primary, auto, false, "usage limit reached", ""),
                Some(fallback)
            );
            assert_eq!(
                fallback_for_limit(fallback, auto, true, "usage limit reached", ""),
                None
            );
            for error in ["invalid JSON", "Not logged in", "connection refused", ""] {
                assert_eq!(fallback_for_limit(primary, auto, false, error, ""), None);
            }
        }
        assert_eq!(
            fallback_for_limit(Agent::OpenCode, auto, false, "usage limit", ""),
            None
        );
    }

    #[test]
    fn suggestion_fence_outlasts_content() {
        let body = comment_body(&finding(true, Some("let s = \"```\";")));
        assert!(body.contains("\n````suggestion\nlet s = \"```\";\n````"));
        assert!(body.starts_with("**🟠 High · security** — SQL built from input"));
    }

    #[test]
    fn review_body_lists_non_inline_findings() {
        let findings = [finding(true, None), finding(false, None)];
        let body = review_body("Adds a query.", &findings, Agent::Codex, "abcdef123", false);
        assert!(body.contains("**Findings:** 🟠 High 2"));
        assert_eq!(body.matches("`src/a.rs:4`").count(), 1);
        assert!(body.contains("Agent: codex · Commit abcdef1"));
        let all = review_body("", &findings, Agent::Codex, "abc", true);
        assert_eq!(all.matches("`src/a.rs:4`").count(), 2);
    }

    #[test]
    fn redacts_known_secrets() {
        let secrets = vec!["sk-ant-secret-value".to_owned(), "short".to_owned()];
        let out = redact("key=sk-ant-secret-value short", &secrets);
        assert_eq!(out, "key=[redacted] short");
    }
}
