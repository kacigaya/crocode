//! Postgres queries. The `reviews` table is also the job queue.

use std::collections::HashSet;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

pub type Db = PgPool;

pub async fn connect(url: &str) -> anyhow::Result<Db> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(10))
        .connect(url)
        .await?;
    let privileged: bool = sqlx::query_scalar(
        "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls
         FROM pg_roles WHERE rolname = current_user",
    )
    .fetch_one(&pool)
    .await?;
    anyhow::ensure!(
        !privileged,
        "DATABASE_URL must use a restricted runtime role; run crocode migrate separately"
    );
    Ok(pool)
}

pub async fn migrate(url: &str) -> anyhow::Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(url)
        .await?;
    sqlx::migrate!("../../migrations").run(&pool).await?;
    // The runtime role must not be able to change migration history.
    sqlx::query(
        "DO $$ BEGIN
         IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crocode_runtime') THEN
             REVOKE ALL ON _sqlx_migrations FROM crocode_runtime;
         END IF;
         END $$",
    )
    .execute(&pool)
    .await?;
    pool.close().await;
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Installation {
    pub id: i64,
    pub account_id: i64,
    pub account_login: String,
    pub account_type: String,
    pub repository_selection: String,
    pub suspended: bool,
    pub enabled: bool,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub created_at: DateTime<Utc>,
    /// Secret. Never return it from the API.
    pub digest_webhook_url: Option<String>,
    pub digest_sent_at: Option<DateTime<Utc>>,
    pub digest_attempted_at: Option<DateTime<Utc>>,
    pub digest_error: Option<String>,
}

const INSTALLATION_COLUMNS: &str =
    "id, account_id, account_login, account_type, repository_selection,
    suspended, enabled, agent, model, created_at,
    digest_webhook_url, digest_sent_at, digest_attempted_at, digest_error";

pub struct InstallationUpsert<'a> {
    pub id: i64,
    pub account_id: i64,
    pub account_login: &'a str,
    pub account_type: &'a str,
    pub repository_selection: Option<&'a str>,
}

pub async fn upsert_installation(db: &Db, i: &InstallationUpsert<'_>) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO installations (id, account_id, account_login, account_type, repository_selection)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'selected'))
         ON CONFLICT (id) DO UPDATE SET
            account_login = EXCLUDED.account_login,
            account_type = EXCLUDED.account_type,
            repository_selection = COALESCE($5, installations.repository_selection),
            deleted = FALSE,
            updated_at = now()",
    )
    .bind(i.id)
    .bind(i.account_id)
    .bind(i.account_login)
    .bind(i.account_type)
    .bind(i.repository_selection)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn set_installation_state(
    db: &Db,
    id: i64,
    suspended: bool,
    deleted: bool,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE installations SET suspended = $2, deleted = $3, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .bind(suspended)
    .bind(deleted)
    .execute(db)
    .await?;
    if suspended || deleted {
        sqlx::query(
            "UPDATE reviews SET status = 'cancelled', finished_at = now(), error = 'installation removed'
             WHERE installation_id = $1 AND status IN ('queued', 'running')",
        )
        .bind(id)
        .execute(db)
        .await?;
    }
    Ok(())
}

pub async fn installation(db: &Db, id: i64) -> sqlx::Result<Option<Installation>> {
    let sql =
        format!("SELECT {INSTALLATION_COLUMNS} FROM installations WHERE id = $1 AND NOT deleted");
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn installations(db: &Db, ids: &[i64]) -> sqlx::Result<Vec<Installation>> {
    let sql = format!(
        "SELECT {INSTALLATION_COLUMNS} FROM installations
         WHERE id = ANY($1) AND NOT deleted ORDER BY account_login"
    );
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(ids)
        .fetch_all(db)
        .await
}

/// `digest_webhook_url`: `None` keeps the current value, `Some(None)` turns
/// the digest off. A new URL clears the last result and sends soon.
pub async fn update_settings(
    db: &Db,
    id: i64,
    enabled: bool,
    agent: Option<&str>,
    model: Option<&str>,
    digest_webhook_url: Option<Option<&str>>,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE installations SET enabled = $2, agent = $3, model = $4,
            digest_webhook_url = CASE WHEN $5 THEN $6 ELSE digest_webhook_url END,
            digest_attempted_at = CASE WHEN $5 AND $6 IS DISTINCT FROM digest_webhook_url
                                       THEN NULL ELSE digest_attempted_at END,
            digest_error = CASE WHEN $5 AND $6 IS DISTINCT FROM digest_webhook_url
                                THEN NULL ELSE digest_error END,
            digest_sent_at = CASE WHEN $5 AND $6 IS DISTINCT FROM digest_webhook_url
                                  THEN NULL ELSE digest_sent_at END,
            updated_at = now()
         WHERE id = $1",
    )
    .bind(id)
    .bind(enabled)
    .bind(agent)
    .bind(model)
    .bind(digest_webhook_url.is_some())
    .bind(digest_webhook_url.flatten())
    .execute(db)
    .await?;
    Ok(())
}

/// Records a webhook delivery. Returns false when it was seen before.
pub async fn record_delivery(db: &Db, id: &str, event: &str) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "INSERT INTO webhook_deliveries (id, event) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(id)
    .bind(event)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}

pub struct NewReview<'a> {
    pub installation_id: i64,
    pub repo_id: i64,
    pub repo_full_name: &'a str,
    pub pr_number: i64,
    pub pr_title: &'a str,
    pub head_sha: &'a str,
    pub base_sha: &'a str,
}

/// Queues a review unless this head commit already has one. Older open
/// reviews of the same pull request are cancelled.
pub async fn enqueue_review(db: &Db, r: &NewReview<'_>) -> sqlx::Result<Option<Uuid>> {
    let mut tx = db.begin().await?;
    lock_pull(&mut tx, r.repo_id, r.pr_number).await?;
    cancel_pr_reviews(
        &mut *tx,
        r.repo_id,
        r.pr_number,
        Some(r.head_sha),
        "superseded",
    )
    .await?;
    let id: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO reviews (id, installation_id, repo_id, repo_full_name, pr_number, pr_title, head_sha, base_sha)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (repo_id, pr_number, head_sha) DO NOTHING
         RETURNING id",
    )
    .bind(Uuid::new_v4())
    .bind(r.installation_id)
    .bind(r.repo_id)
    .bind(r.repo_full_name)
    .bind(r.pr_number as i32)
    .bind(r.pr_title)
    .bind(r.head_sha)
    .bind(r.base_sha)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(id)
}

pub async fn cancel_pr_reviews<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    repo_id: i64,
    pr_number: i64,
    keep_sha: Option<&str>,
    reason: &str,
) -> sqlx::Result<u64> {
    let result = sqlx::query(
        "UPDATE reviews SET status = 'cancelled', finished_at = now(), error = $4
         WHERE repo_id = $1 AND pr_number = $2 AND status IN ('queued', 'running')
           AND ($3::text IS NULL OR head_sha <> $3)",
    )
    .bind(repo_id)
    .bind(pr_number as i32)
    .bind(keep_sha)
    .bind(reason)
    .execute(executor)
    .await?;
    Ok(result.rows_affected())
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Job {
    pub id: Uuid,
    pub installation_id: i64,
    pub repo_id: i64,
    pub repo_full_name: String,
    pub pr_number: i32,
    pub head_sha: String,
    pub attempts: i32,
    pub max_attempts: i32,
    pub github_review_id: Option<i64>,
}

/// Claims the next due review. Skips installations that already run
/// `max_per_installation` reviews, so one tenant cannot starve the others.
/// The per-installation limit is soft under concurrent claims.
pub async fn claim_review(
    db: &Db,
    worker: &str,
    max_per_installation: i64,
) -> sqlx::Result<Option<Job>> {
    sqlx::query_as(
        "UPDATE reviews SET status = 'running', attempts = attempts + 1, locked_by = $1,
                heartbeat_at = now(), started_at = COALESCE(started_at, now())
         WHERE id = (
            SELECT r.id FROM reviews r
            WHERE r.status = 'queued' AND r.run_after <= now()
              AND (SELECT count(*) FROM reviews x
                   WHERE x.installation_id = r.installation_id AND x.status = 'running') < $2
            ORDER BY r.run_after
            FOR UPDATE SKIP LOCKED
            LIMIT 1)
         RETURNING id, installation_id, repo_id, repo_full_name, pr_number, head_sha,
                   attempts, max_attempts, github_review_id",
    )
    .bind(worker)
    .bind(max_per_installation)
    .fetch_optional(db)
    .await
}

/// Refreshes the lease. Returns false when the review is no longer ours,
/// for example after cancellation.
pub async fn heartbeat(db: &Db, id: Uuid, worker: &str) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE reviews SET heartbeat_at = now()
         WHERE id = $1 AND status = 'running' AND locked_by = $2",
    )
    .bind(id)
    .bind(worker)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Requeues reviews whose worker stopped sending heartbeats.
pub async fn requeue_stale(db: &Db, older_than: Duration) -> sqlx::Result<u64> {
    let result = sqlx::query(
        "UPDATE reviews SET
            status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
            error = 'worker lost', locked_by = NULL,
            finished_at = CASE WHEN attempts >= max_attempts THEN now() END
         WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => $1)",
    )
    .bind(older_than.as_secs_f64())
    .execute(db)
    .await?;
    // A worker that died after another writer finished its review never
    // releases the lease. Drop it so the review can be retried.
    sqlx::query(
        "UPDATE reviews SET locked_by = NULL
         WHERE status <> 'running' AND locked_by IS NOT NULL
           AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => $1))",
    )
    .bind(older_than.as_secs_f64())
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

pub async fn prune_deliveries(db: &Db) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM webhook_deliveries WHERE received_at < now() - interval '7 days'")
        .execute(db)
        .await?;
    Ok(())
}

pub async fn prune_reviews(db: &Db) -> sqlx::Result<u64> {
    // Keep active jobs. Child findings and patches are removed by foreign keys.
    let result = sqlx::query(
        "DELETE FROM reviews r
         WHERE EXISTS (SELECT FROM installations i WHERE i.id = r.installation_id AND i.deleted)
            OR (r.status NOT IN ('queued', 'running')
                AND COALESCE(r.finished_at, r.created_at) < now() - interval '30 days')",
    )
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

#[derive(Default)]
pub struct Finish<'a> {
    pub status: &'a str,
    pub summary: Option<&'a str>,
    pub error: Option<&'a str>,
    pub agent: Option<&'a str>,
    pub model: Option<&'a str>,
    /// Time in agent processes. Null when no agent ran.
    pub agent_ms: Option<i64>,
    pub input_tokens: Option<i64>,
    pub cached_input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}

/// Sets a final state. Has no effect when the review is no longer ours.
pub async fn finish_review(db: &Db, id: Uuid, worker: &str, f: &Finish<'_>) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE reviews SET status = $3, summary = $4, error = $5,
                agent = COALESCE($6, agent), model = COALESCE($7, model),
                agent_duration_ms = $8, input_tokens = $9, cached_input_tokens = $10,
                output_tokens = $11, finished_at = now(), locked_by = NULL
         WHERE id = $1 AND status = 'running' AND locked_by = $2",
    )
    .bind(id)
    .bind(worker)
    .bind(f.status)
    .bind(f.summary)
    .bind(f.error)
    .bind(f.agent)
    .bind(f.model)
    .bind(f.agent_ms)
    .bind(f.input_tokens)
    .bind(f.cached_input_tokens)
    .bind(f.output_tokens)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn retry_review(
    db: &Db,
    id: Uuid,
    worker: &str,
    error: &str,
    delay: Duration,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE reviews SET status = 'queued', error = $3, locked_by = NULL,
                run_after = now() + make_interval(secs => $4)
         WHERE id = $1 AND status = 'running' AND locked_by = $2",
    )
    .bind(id)
    .bind(worker)
    .bind(error)
    .bind(delay.as_secs_f64())
    .execute(db)
    .await?;
    Ok(())
}

/// Puts a review back in the queue without counting the attempt. Used on shutdown.
pub async fn release_review(db: &Db, id: Uuid, worker: &str) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE reviews SET status = 'queued', attempts = GREATEST(attempts - 1, 0), locked_by = NULL
         WHERE id = $1 AND status = 'running' AND locked_by = $2",
    )
    .bind(id)
    .bind(worker)
    .execute(db)
    .await?;
    Ok(())
}

/// Records the agent before it runs, so running and failed reviews show it.
pub async fn set_review_agent(
    db: &Db,
    id: Uuid,
    worker: &str,
    agent: &str,
    model: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE reviews SET agent = $3, model = $4
         WHERE id = $1 AND status = 'running' AND locked_by = $2",
    )
    .bind(id)
    .bind(worker)
    .bind(agent)
    .bind(model)
    .execute(db)
    .await?;
    Ok(())
}

/// Cancels a queued or running review. A running worker sees the change at
/// its next heartbeat and stops the agent. The worker keeps its lease until it
/// has stopped, see [`release_lock`]. Returns false when the review was not
/// queued or running.
pub async fn cancel_review(db: &Db, id: Uuid) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE reviews SET status = 'cancelled', finished_at = now(),
                error = 'cancelled from the dashboard'
         WHERE id = $1 AND status IN ('queued', 'running')",
    )
    .bind(id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Drops the lease of a review that another writer finished, after the worker
/// has stopped its agent.
pub async fn release_lock(db: &Db, id: Uuid, worker: &str) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE reviews SET locked_by = NULL
         WHERE id = $1 AND locked_by = $2 AND status <> 'running'",
    )
    .bind(id)
    .bind(worker)
    .execute(db)
    .await?;
    Ok(())
}

/// Queues a failed or cancelled review again with fresh attempts. Only the
/// newest review of a pull request qualifies, and only while no other review
/// of it is active, so an old commit never replaces a newer one. A review
/// whose worker still holds the lease waits, so two runs never share a work
/// directory or container name. The GitHub
/// review ID stays, so a review that was already posted is not posted twice.
/// Returns false when the review does not qualify.
pub async fn requeue_review(db: &Db, id: Uuid) -> sqlx::Result<bool> {
    let mut tx = db.begin().await?;
    let Some((repo_id, pr_number)): Option<(i64, i32)> =
        sqlx::query_as("SELECT repo_id, pr_number FROM reviews WHERE id = $1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
    else {
        return Ok(false);
    };
    lock_pull(&mut tx, repo_id, pr_number.into()).await?;
    let result = sqlx::query(
        "UPDATE reviews r SET status = 'queued', attempts = 0, run_after = now(),
                created_at = now(), started_at = NULL, finished_at = NULL, heartbeat_at = NULL,
                locked_by = NULL, error = NULL, summary = NULL, agent = NULL, model = NULL,
                agent_duration_ms = NULL, input_tokens = NULL, cached_input_tokens = NULL,
                output_tokens = NULL
         WHERE r.id = $1 AND r.status IN ('failed', 'cancelled') AND r.locked_by IS NULL
           AND NOT EXISTS (
               SELECT FROM reviews x
               WHERE x.repo_id = r.repo_id AND x.pr_number = r.pr_number AND x.id <> r.id
                 AND (x.status IN ('queued', 'running') OR x.created_at > r.created_at))",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(result.rows_affected() == 1)
}

/// Serializes queue changes of one pull request until the transaction ends,
/// so a push and a dashboard retry cannot both queue a review.
async fn lock_pull(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    repo_id: i64,
    pr_number: i64,
) -> sqlx::Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("crocode:pull:{repo_id}:{pr_number}"))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Fingerprints that other reviews of the pull request published. The rows of
/// `review_id` itself are left out: a retried review replaces them, and its
/// earlier attempt may already have posted them.
pub async fn published_fingerprints(
    db: &Db,
    repo_id: i64,
    pr_number: i64,
    review_id: Uuid,
) -> sqlx::Result<HashSet<String>> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT fingerprint FROM findings
         WHERE repo_id = $1 AND pr_number = $2 AND published AND review_id <> $3",
    )
    .bind(repo_id)
    .bind(pr_number as i32)
    .bind(review_id)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().collect())
}

/// Saves the GitHub review ID and marks the posted findings, together.
pub async fn mark_published(
    db: &Db,
    review_id: Uuid,
    github_review_id: i64,
    fingerprints: &[&str],
) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE reviews SET github_review_id = $2 WHERE id = $1")
        .bind(review_id)
        .bind(github_review_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE findings SET published = TRUE WHERE review_id = $1 AND fingerprint = ANY($2)",
    )
    .bind(review_id)
    .bind(fingerprints)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// Fingerprints that an earlier attempt of this review published.
pub async fn review_published_fingerprints(
    db: &Db,
    review_id: Uuid,
) -> sqlx::Result<HashSet<String>> {
    let rows: Vec<String> =
        sqlx::query_scalar("SELECT fingerprint FROM findings WHERE review_id = $1 AND published")
            .bind(review_id)
            .fetch_all(db)
            .await?;
    Ok(rows.into_iter().collect())
}

pub struct NewFinding<'a> {
    pub fingerprint: &'a str,
    pub path: &'a str,
    pub start_line: Option<u32>,
    pub line: u32,
    pub severity: &'a str,
    pub category: &'a str,
    pub title: &'a str,
    pub body: &'a str,
    pub suggestion: Option<&'a str>,
    pub published: bool,
}

pub async fn insert_findings(
    db: &Db,
    review_id: Uuid,
    repo_id: i64,
    pr_number: i64,
    findings: &[NewFinding<'_>],
    files: &[(&str, &str)],
) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    // A retried review replaces the unpublished findings of its earlier
    // attempt. Published rows stay as the record of what GitHub received;
    // callers skip their fingerprints.
    sqlx::query("DELETE FROM findings WHERE review_id = $1 AND NOT published")
        .bind(review_id)
        .execute(&mut *tx)
        .await?;
    for f in findings {
        sqlx::query(
            "INSERT INTO findings (id, review_id, repo_id, pr_number, fingerprint, path, start_line,
                                   line, severity, category, title, body, suggestion, published)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
        )
        .bind(Uuid::new_v4())
        .bind(review_id)
        .bind(repo_id)
        .bind(pr_number as i32)
        .bind(f.fingerprint)
        .bind(f.path)
        .bind(f.start_line.map(|n| n as i32))
        .bind(f.line as i32)
        .bind(f.severity)
        .bind(f.category)
        .bind(f.title)
        .bind(f.body)
        .bind(f.suggestion)
        .bind(f.published)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("DELETE FROM review_files WHERE review_id = $1")
        .bind(review_id)
        .execute(&mut *tx)
        .await?;
    for (path, patch) in files {
        sqlx::query("INSERT INTO review_files (review_id, path, patch) VALUES ($1, $2, $3)")
            .bind(review_id)
            .bind(path)
            .bind(patch)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReviewRow {
    pub id: Uuid,
    pub installation_id: i64,
    pub repo_full_name: String,
    pub pr_number: i32,
    pub pr_title: String,
    pub head_sha: String,
    pub status: String,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub attempts: i32,
    pub finding_count: i64,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub agent_duration_ms: Option<i64>,
    pub input_tokens: Option<i64>,
    pub cached_input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}

const REVIEW_COLUMNS: &str = "r.id, r.installation_id, r.repo_full_name, r.pr_number, r.pr_title,
    r.head_sha, r.status, r.agent, r.model, r.attempts,
    (SELECT count(*) FROM findings f WHERE f.review_id = r.id) AS finding_count,
    r.error, r.created_at, r.finished_at, r.agent_duration_ms, r.input_tokens,
    r.cached_input_tokens, r.output_tokens";

/// Reviews of one installation, newest first. `pull` limits the list to one
/// pull request as `(repo_full_name, number)`.
pub async fn list_reviews(
    db: &Db,
    installation_id: i64,
    before: Option<DateTime<Utc>>,
    pull: Option<(&str, i32)>,
    limit: i64,
) -> sqlx::Result<Vec<ReviewRow>> {
    let sql = format!(
        "SELECT {REVIEW_COLUMNS} FROM reviews r
         WHERE r.installation_id = $1 AND ($2::timestamptz IS NULL OR r.created_at < $2)
           AND ($3::text IS NULL OR (r.repo_full_name = $3 AND r.pr_number = $4))
         ORDER BY r.created_at DESC LIMIT $5"
    );
    // The query text is built from constants only.
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(installation_id)
        .bind(before)
        .bind(pull.map(|(repo, _)| repo))
        .bind(pull.map(|(_, number)| number))
        .bind(limit)
        .fetch_all(db)
        .await
}

/// The newest review of each listed pull request.
pub async fn latest_reviews(
    db: &Db,
    installation_id: i64,
    pulls: &[(String, i32)],
) -> sqlx::Result<Vec<ReviewRow>> {
    let (repos, numbers): (Vec<&str>, Vec<i32>) =
        pulls.iter().map(|(repo, n)| (repo.as_str(), *n)).unzip();
    let sql = format!(
        "SELECT DISTINCT ON (r.repo_full_name, r.pr_number) {REVIEW_COLUMNS} FROM reviews r
         WHERE r.installation_id = $1
           AND (r.repo_full_name, r.pr_number) IN (SELECT * FROM unnest($2::text[], $3::int[]))
         ORDER BY r.repo_full_name, r.pr_number, r.created_at DESC"
    );
    sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(installation_id)
        .bind(repos)
        .bind(numbers)
        .fetch_all(db)
        .await
}

/// Days of history in [`stats`]. Matches the review retention in [`prune_reviews`].
pub const STATS_DAYS: i32 = 30;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReviewTotals {
    pub reviews: i64,
    pub succeeded: i64,
    pub failed: i64,
    pub in_progress: i64,
    pub pull_requests: i64,
    pub repositories: i64,
    /// From queue to result, for succeeded reviews.
    pub median_duration_secs: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Count {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Day {
    pub date: String,
    pub reviews: i64,
    pub failed: i64,
}

/// Reviews of one agent. Token sums cover only reviews that reported usage.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AgentUsage {
    pub name: String,
    pub reviews: i64,
    pub succeeded: i64,
    pub failed: i64,
    pub median_agent_secs: Option<f64>,
    /// Reviews that reported token usage.
    pub usage_reviews: i64,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub models: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct Stats {
    pub days: i32,
    #[serde(flatten)]
    pub totals: ReviewTotals,
    pub findings: i64,
    pub published: i64,
    pub severity: Vec<Count>,
    /// The five most common categories.
    pub categories: Vec<Count>,
    /// One entry per UTC day, oldest first.
    pub daily: Vec<Day>,
    /// Reviews with a picked agent, most used first.
    pub agents: Vec<AgentUsage>,
}

pub async fn stats(db: &Db, installation_id: i64) -> sqlx::Result<Stats> {
    let mut tx = db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await?;
    let totals: ReviewTotals = sqlx::query_as(
        "SELECT count(*) AS reviews,
                count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
                count(*) FILTER (WHERE status = 'failed') AS failed,
                count(*) FILTER (WHERE status IN ('queued', 'running')) AS in_progress,
                count(DISTINCT (repo_full_name, pr_number)) AS pull_requests,
                count(DISTINCT repo_full_name) AS repositories,
                percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY extract(epoch FROM finished_at - created_at)::float8
                ) FILTER (WHERE status = 'succeeded' AND finished_at IS NOT NULL)
                    AS median_duration_secs
         FROM reviews
         WHERE installation_id = $1 AND created_at >= now() - make_interval(days => $2)",
    )
    .bind(installation_id)
    .bind(STATS_DAYS)
    .fetch_one(&mut *tx)
    .await?;
    const FINDINGS: &str = "FROM findings f JOIN reviews r ON r.id = f.review_id
         WHERE r.installation_id = $1 AND r.created_at >= now() - make_interval(days => $2)";
    let (findings, published): (i64, i64) = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT count(*), count(*) FILTER (WHERE f.published) {FINDINGS}"
    )))
    .bind(installation_id)
    .bind(STATS_DAYS)
    .fetch_one(&mut *tx)
    .await?;
    let severity: Vec<Count> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT f.severity AS name, count(*) AS count {FINDINGS} GROUP BY f.severity"
    )))
    .bind(installation_id)
    .bind(STATS_DAYS)
    .fetch_all(&mut *tx)
    .await?;
    let categories: Vec<Count> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT f.category AS name, count(*) AS count {FINDINGS}
         GROUP BY f.category ORDER BY count(*) DESC, f.category LIMIT 5"
    )))
    .bind(installation_id)
    .bind(STATS_DAYS)
    .fetch_all(&mut *tx)
    .await?;
    let daily: Vec<Day> = sqlx::query_as(
        "SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
                count(r.id) AS reviews,
                count(r.id) FILTER (WHERE r.status = 'failed') AS failed
         FROM generate_series(
                (now() AT TIME ZONE 'UTC')::date - ($2 - 1),
                (now() AT TIME ZONE 'UTC')::date,
                interval '1 day') AS d(day)
         LEFT JOIN reviews r ON r.installation_id = $1
              AND (r.created_at AT TIME ZONE 'UTC')::date = d.day::date
         GROUP BY d.day ORDER BY d.day",
    )
    .bind(installation_id)
    .bind(STATS_DAYS)
    .fetch_all(&mut *tx)
    .await?;
    let agents: Vec<AgentUsage> = sqlx::query_as(
        "SELECT agent AS name, count(*) AS reviews,
                count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
                count(*) FILTER (WHERE status = 'failed') AS failed,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY agent_duration_ms / 1000.0)
                    FILTER (WHERE agent_duration_ms IS NOT NULL) AS median_agent_secs,
                count(input_tokens) AS usage_reviews,
                COALESCE(sum(input_tokens), 0)::int8 AS input_tokens,
                COALESCE(sum(cached_input_tokens), 0)::int8 AS cached_input_tokens,
                COALESCE(sum(output_tokens), 0)::int8 AS output_tokens,
                COALESCE(array_agg(DISTINCT model) FILTER (WHERE model IS NOT NULL), '{}')
                    AS models
         FROM reviews
         WHERE installation_id = $1 AND agent IS NOT NULL
           AND created_at >= now() - make_interval(days => $2)
         GROUP BY agent ORDER BY count(*) DESC, agent",
    )
    .bind(installation_id)
    .bind(STATS_DAYS)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Stats {
        days: STATS_DAYS,
        totals,
        findings,
        published,
        severity,
        categories,
        daily,
        agents,
    })
}

pub async fn save_agent_models<T: Serialize>(db: &Db, agent: &str, models: &T) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO agent_models (agent, models, available, detected_at, checked_at)
         VALUES ($1, $2, TRUE, now(), now())
         ON CONFLICT (agent) DO UPDATE SET models = EXCLUDED.models, available = TRUE,
             detected_at = now(), checked_at = now()",
    )
    .bind(agent)
    .bind(sqlx::types::Json(models))
    .execute(db)
    .await?;
    Ok(())
}

/// Records a failed model list run. Keeps the models of the last success.
pub async fn mark_agent_unavailable(db: &Db, agent: &str) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO agent_models (agent, models, available, checked_at)
         VALUES ($1, '[]', FALSE, now())
         ON CONFLICT (agent) DO UPDATE SET available = FALSE, checked_at = now()",
    )
    .bind(agent)
    .execute(db)
    .await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub struct AgentModels {
    pub agent: String,
    pub models: serde_json::Value,
    /// False when the latest model list run failed.
    pub available: bool,
    pub checked_at: DateTime<Utc>,
}

/// Stored model lists and check results by agent name.
pub async fn agent_models(db: &Db) -> sqlx::Result<Vec<AgentModels>> {
    sqlx::query_as("SELECT agent, models, available, checked_at FROM agent_models ORDER BY agent")
        .fetch_all(db)
        .await
}

pub async fn review(db: &Db, id: Uuid) -> sqlx::Result<Option<(ReviewRow, Option<String>)>> {
    let sql = format!("SELECT {REVIEW_COLUMNS}, r.summary FROM reviews r WHERE r.id = $1");
    let row: Option<ReviewWithSummary> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(id)
        .fetch_optional(db)
        .await?;
    Ok(row.map(|r| (r.review, r.summary)))
}

#[derive(sqlx::FromRow)]
struct ReviewWithSummary {
    #[sqlx(flatten)]
    review: ReviewRow,
    summary: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FindingRow {
    pub id: Uuid,
    pub path: String,
    pub start_line: Option<i32>,
    pub line: i32,
    pub severity: String,
    pub category: String,
    pub title: String,
    pub body: String,
    pub suggestion: Option<String>,
    pub published: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReviewFileRow {
    pub path: String,
    pub patch: String,
}

pub async fn review_contents(
    db: &Db,
    review_id: Uuid,
) -> sqlx::Result<(Vec<FindingRow>, Vec<ReviewFileRow>)> {
    let mut tx = db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await?;
    let findings = sqlx::query_as(
        "SELECT id, path, start_line, line, severity, category, title, body, suggestion, published
         FROM findings WHERE review_id = $1
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
                                WHEN 'low' THEN 3 ELSE 4 END, path, line",
    )
    .bind(review_id)
    .fetch_all(&mut *tx)
    .await?;
    let files =
        sqlx::query_as("SELECT path, patch FROM review_files WHERE review_id = $1 ORDER BY path")
            .bind(review_id)
            .fetch_all(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok((findings, files))
}

#[derive(Debug, sqlx::FromRow)]
pub struct DigestJob {
    pub id: i64,
    pub account_login: String,
    pub digest_webhook_url: String,
    pub digest_sent_at: Option<DateTime<Utc>>,
}

/// Claims one installation whose weekly digest is due. A failed send is
/// tried again after an hour. Safe with several workers.
pub async fn claim_digest(db: &Db) -> sqlx::Result<Option<DigestJob>> {
    sqlx::query_as(
        "UPDATE installations SET digest_attempted_at = now()
         WHERE id = (
            SELECT id FROM installations
            WHERE digest_webhook_url IS NOT NULL AND NOT deleted AND NOT suspended
              AND (digest_sent_at IS NULL OR digest_sent_at <= now() - interval '7 days')
              AND (digest_attempted_at IS NULL OR digest_attempted_at <= now() - interval '1 hour')
            ORDER BY digest_attempted_at NULLS FIRST
            FOR UPDATE SKIP LOCKED
            LIMIT 1)
         RETURNING id, account_login, digest_webhook_url, digest_sent_at",
    )
    .fetch_optional(db)
    .await
}

/// Records a digest result. `Ok` holds the start of the alert read, so the next
/// window starts there and misses no alert. Has no effect when an admin
/// changed the URL after the claim.
pub async fn finish_digest(
    db: &Db,
    job: &DigestJob,
    result: Result<DateTime<Utc>, &str>,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE installations SET digest_error = $3,
            digest_sent_at = COALESCE($4, digest_sent_at)
         WHERE id = $1 AND digest_webhook_url = $2",
    )
    .bind(job.id)
    .bind(&job.digest_webhook_url)
    .bind(result.err())
    .bind(result.ok())
    .execute(db)
    .await?;
    Ok(())
}
