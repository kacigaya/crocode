//! Database tests use separate databases created by SQLx. No GitHub calls run.

use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use chrono::{DateTime, Utc};
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::{AppState, db, github::GitHub, router, settings::Settings};

fn state(pool: PgPool) -> AppState {
    AppState {
        db: pool,
        github: GitHub::for_test(),
        settings: Arc::new(Settings::for_test()),
        auth: Arc::default(),
        pulls: Arc::default(),
        vulnerability_checks: Arc::default(),
        webhook_key: Arc::new(crate::digest::WebhookKey::derive(b"test-key")),
    }
}

async fn webhook(
    state: &AppState,
    event: &str,
    delivery: &str,
    payload: Value,
    valid_signature: bool,
) -> (StatusCode, String) {
    let body = serde_json::to_vec(&payload).unwrap();
    let mut mac = Hmac::<Sha256>::new_from_slice(&state.settings.github_webhook_secret).unwrap();
    mac.update(&body);
    let signature = if valid_signature {
        format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
    } else {
        format!("sha256={}", "00".repeat(32))
    };
    let response = router(state.clone())
        .oneshot(
            Request::post("/webhooks/github")
                .header("x-github-event", event)
                .header("x-github-delivery", delivery)
                .header("x-hub-signature-256", signature)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

fn pull_request(action: &str, sha: &str) -> Value {
    json!({
        "action": action,
        "installation": {"id": 1},
        "repository": {
            "id": 10, "full_name": "acme/api",
            "owner": {"id": 100, "login": "acme", "type": "Organization"}
        },
        "pull_request": {
            "number": 7, "title": "Fix login",
            "head": {"sha": sha}, "base": {"sha": "base"}
        }
    })
}

async fn statuses(pool: &PgPool) -> Vec<(String, String)> {
    sqlx::query_as("SELECT head_sha, status FROM reviews ORDER BY head_sha")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn webhook_signature_dedupe_and_pr_lifecycle(pool: PgPool) {
    let state = state(pool.clone());
    let opened = pull_request("opened", "head1");
    assert_eq!(
        webhook(&state, "pull_request", "opened", opened.clone(), false).await,
        (StatusCode::UNAUTHORIZED, "bad signature".into())
    );
    assert!(statuses(&pool).await.is_empty());
    let deliveries: i64 = sqlx::query_scalar("SELECT count(*) FROM webhook_deliveries")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(deliveries, 0);
    assert_eq!(
        webhook(&state, "pull_request", "opened", opened.clone(), true).await,
        (StatusCode::ACCEPTED, "review queued".into())
    );
    assert_eq!(statuses(&pool).await, [("head1".into(), "queued".into())]);
    assert_eq!(
        webhook(&state, "pull_request", "opened", opened, true).await,
        (StatusCode::OK, "duplicate delivery".into())
    );
    assert_eq!(
        webhook(
            &state,
            "pull_request",
            "sync",
            pull_request("synchronize", "head2"),
            true
        )
        .await,
        (StatusCode::ACCEPTED, "review queued".into())
    );
    assert_eq!(
        statuses(&pool).await,
        [
            ("head1".into(), "cancelled".into()),
            ("head2".into(), "queued".into())
        ]
    );
    assert_eq!(
        webhook(
            &state,
            "pull_request",
            "same-sha",
            pull_request("synchronize", "head2"),
            true
        )
        .await,
        (StatusCode::ACCEPTED, "commit already reviewed".into())
    );
    assert_eq!(statuses(&pool).await.len(), 2);
    assert_eq!(
        webhook(
            &state,
            "pull_request",
            "closed",
            pull_request("closed", "head2"),
            true
        )
        .await,
        (StatusCode::ACCEPTED, "reviews cancelled".into())
    );
    assert!(
        statuses(&pool)
            .await
            .iter()
            .all(|(_, status)| status == "cancelled")
    );
}

async fn installation(pool: &PgPool, id: i64) {
    db::upsert_installation(
        pool,
        &db::InstallationUpsert {
            id,
            account_id: id + 100,
            account_login: "acme",
            account_type: "Organization",
            repository_selection: Some("selected"),
        },
    )
    .await
    .unwrap();
}

async fn enqueue(pool: &PgPool, installation_id: i64, pr_number: i64) -> Uuid {
    db::enqueue_review(
        pool,
        &db::NewReview {
            installation_id,
            repo_id: installation_id * 10,
            repo_full_name: "acme/api",
            pr_number,
            pr_title: "Fix login",
            head_sha: "head",
            base_sha: "base",
        },
    )
    .await
    .unwrap()
    .unwrap()
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn installation_deleted_cancels_queued_and_running_reviews(pool: PgPool) {
    installation(&pool, 1).await;
    installation(&pool, 2).await;
    let running = enqueue(&pool, 1, 1).await;
    db::claim_review(&pool, "worker", 1).await.unwrap().unwrap();
    let queued = enqueue(&pool, 1, 2).await;
    let other = enqueue(&pool, 2, 1).await;
    assert_eq!(
        webhook(
            &state(pool.clone()),
            "installation",
            "deleted",
            json!({
                "action": "deleted", "installation": {"id": 1}
            }),
            true
        )
        .await,
        (StatusCode::ACCEPTED, "installation updated".into())
    );
    for id in [running, queued] {
        let (review, _) = db::review(&pool, id).await.unwrap().unwrap();
        assert_eq!(review.status, "cancelled");
        assert!(review.finished_at.is_some());
    }
    assert!(db::installation(&pool, 1).await.unwrap().is_none());
    assert_eq!(
        db::review(&pool, other).await.unwrap().unwrap().0.status,
        "queued"
    );
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn claim_respects_installation_cap_and_skips_locked_rows(pool: PgPool) {
    installation(&pool, 1).await;
    installation(&pool, 2).await;
    let first = enqueue(&pool, 1, 1).await;
    let second = enqueue(&pool, 1, 2).await;
    let other = enqueue(&pool, 2, 1).await;
    let mut lock = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM reviews WHERE id = $1 FOR UPDATE")
        .bind(first)
        .execute(&mut *lock)
        .await
        .unwrap();
    let job = db::claim_review(&pool, "a", 1).await.unwrap().unwrap();
    assert_eq!(job.id, second);
    assert_eq!(job.attempts, 1);
    lock.rollback().await.unwrap();
    assert_eq!(
        db::claim_review(&pool, "b", 1).await.unwrap().unwrap().id,
        other
    );
    assert!(db::claim_review(&pool, "c", 1).await.unwrap().is_none());
    assert_eq!(
        db::review(&pool, first).await.unwrap().unwrap().0.status,
        "queued"
    );
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn heartbeat_stops_after_cancel(pool: PgPool) {
    installation(&pool, 1).await;
    let id = enqueue(&pool, 1, 1).await;
    db::claim_review(&pool, "worker", 1).await.unwrap().unwrap();
    assert!(db::heartbeat(&pool, id, "worker").await.unwrap());
    assert!(!db::heartbeat(&pool, id, "other").await.unwrap());
    db::cancel_pr_reviews(&pool, 10, 1, None, "superseded")
        .await
        .unwrap();
    assert!(!db::heartbeat(&pool, id, "worker").await.unwrap());
    db::release_review(&pool, id, "worker").await.unwrap();
    assert_eq!(
        db::review(&pool, id).await.unwrap().unwrap().0.status,
        "cancelled"
    );
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn retry_sets_run_after_and_preserves_attempt(pool: PgPool) {
    installation(&pool, 1).await;
    let id = enqueue(&pool, 1, 1).await;
    db::claim_review(&pool, "worker", 1).await.unwrap().unwrap();
    db::retry_review(&pool, id, "other", "ignored", Duration::from_secs(60))
        .await
        .unwrap();
    assert_eq!(
        db::review(&pool, id).await.unwrap().unwrap().0.status,
        "running"
    );
    db::retry_review(&pool, id, "worker", "transient", Duration::from_secs(60))
        .await
        .unwrap();
    let row: (String, i32, DateTime<Utc>, Option<String>, String, bool) = sqlx::query_as(
        "SELECT status, attempts, run_after, locked_by, error,
                run_after BETWEEN now() + interval '59 seconds' AND now() + interval '61 seconds'
         FROM reviews WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (row.0.as_str(), row.1, row.3, row.4.as_str(), row.5),
        ("queued", 1, None, "transient", true)
    );
    assert!(
        db::claim_review(&pool, "worker", 1)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn release_does_not_count_attempt(pool: PgPool) {
    installation(&pool, 1).await;
    let id = enqueue(&pool, 1, 1).await;
    db::claim_review(&pool, "worker", 1).await.unwrap().unwrap();
    db::release_review(&pool, id, "other").await.unwrap();
    assert_eq!(
        db::review(&pool, id).await.unwrap().unwrap().0.status,
        "running"
    );
    db::release_review(&pool, id, "worker").await.unwrap();
    let (review, _) = db::review(&pool, id).await.unwrap().unwrap();
    assert_eq!((review.status.as_str(), review.attempts), ("queued", 0));
    let job = db::claim_review(&pool, "next", 1).await.unwrap().unwrap();
    assert_eq!((job.id, job.attempts), (id, 1));
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn stale_reviews_requeue_or_fail_at_max_attempts(pool: PgPool) {
    installation(&pool, 1).await;
    let retry = enqueue(&pool, 1, 1).await;
    let failed = enqueue(&pool, 1, 2).await;
    let fresh = enqueue(&pool, 1, 3).await;
    for _ in 0..3 {
        db::claim_review(&pool, "lost", 3).await.unwrap().unwrap();
    }
    sqlx::query(
        "UPDATE reviews SET heartbeat_at = now() - interval '3 minutes',
                 attempts = CASE WHEN id = $1 THEN max_attempts ELSE attempts END
                 WHERE id = ANY($2)",
    )
    .bind(failed)
    .bind(&[retry, failed][..])
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        db::requeue_stale(&pool, Duration::from_secs(120))
            .await
            .unwrap(),
        2
    );
    let rows: Vec<(Uuid, String, i32, Option<String>, bool)> = sqlx::query_as(
        "SELECT id, status, attempts, locked_by, finished_at IS NOT NULL FROM reviews",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for (id, status, attempts, owner, finished) in rows {
        if id == failed {
            assert_eq!(
                (status.as_str(), attempts, owner, finished),
                ("failed", 3, None, true)
            );
        } else if id == retry {
            assert_eq!(
                (status.as_str(), attempts, owner, finished),
                ("queued", 1, None, false)
            );
        } else {
            assert_eq!(id, fresh);
            assert_eq!(
                (status.as_str(), attempts, owner.as_deref(), finished),
                ("running", 1, Some("lost"), false)
            );
        }
    }
    assert!(!db::heartbeat(&pool, retry, "lost").await.unwrap());
    assert_eq!(
        db::claim_review(&pool, "next", 3)
            .await
            .unwrap()
            .unwrap()
            .id,
        retry
    );
}

fn finding(fingerprint: &str, published: bool) -> db::NewFinding<'_> {
    db::NewFinding {
        fingerprint,
        path: "src/login.rs",
        start_line: Some(3),
        line: 4,
        severity: "high",
        category: "security",
        title: "Check the token",
        body: "Reject an invalid token.",
        suggestion: Some("return Err(error);"),
        published,
    }
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn findings_retry_keeps_published_rows_and_dedupes_in_same_pr(pool: PgPool) {
    installation(&pool, 1).await;
    let id = enqueue(&pool, 1, 1).await;
    let other_pr = enqueue(&pool, 1, 2).await;
    db::insert_findings(&pool, other_pr, 10, 2, &[finding("other-pr", true)], &[])
        .await
        .unwrap();
    db::insert_findings(
        &pool,
        id,
        10,
        1,
        &[finding("posted", true), finding("unpublished", false)],
        &[],
    )
    .await
    .unwrap();
    assert_eq!(db::review_contents(&pool, id).await.unwrap().0.len(), 2);
    assert_eq!(
        db::published_fingerprints(&pool, 10, 1, Uuid::nil())
            .await
            .unwrap(),
        ["posted".into()].into()
    );
    assert!(
        db::published_fingerprints(&pool, 20, 1, Uuid::nil())
            .await
            .unwrap()
            .is_empty()
    );
    // A retried review does not count its own posts as seen elsewhere.
    assert!(
        db::published_fingerprints(&pool, 10, 1, id)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        db::review_published_fingerprints(&pool, id).await.unwrap(),
        ["posted".into()].into()
    );

    // The retry replaces unpublished rows and keeps the record of what
    // GitHub received.
    db::insert_findings(&pool, id, 10, 1, &[finding("retry", false)], &[])
        .await
        .unwrap();
    let mut rows: Vec<(String, bool)> = db::review_contents(&pool, id)
        .await
        .unwrap()
        .0
        .into_iter()
        .map(|f| (f.title, f.published))
        .collect();
    rows.sort();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().any(|(_, published)| *published));
    assert!(rows.iter().any(|(_, published)| !*published));
    assert_eq!(
        db::published_fingerprints(&pool, 10, 1, Uuid::nil())
            .await
            .unwrap(),
        ["posted".into()].into()
    );
    assert_eq!(
        db::review_contents(&pool, other_pr).await.unwrap().0.len(),
        1
    );
    // Posting marks exactly the posted findings and saves the review ID.
    db::insert_findings(
        &pool,
        id,
        10,
        1,
        &[finding("sent", false), finding("kept", false)],
        &[],
    )
    .await
    .unwrap();
    db::mark_published(&pool, id, 99, &["sent"]).await.unwrap();
    assert_eq!(
        db::review_published_fingerprints(&pool, id).await.unwrap(),
        ["posted".into(), "sent".into()].into()
    );
    let github_review_id: Option<i64> =
        sqlx::query_scalar("SELECT github_review_id FROM reviews WHERE id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(github_review_id, Some(99));
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn review_files_replace_on_retry(pool: PgPool) {
    installation(&pool, 1).await;
    let id = enqueue(&pool, 1, 1).await;
    let other = enqueue(&pool, 1, 2).await;
    db::insert_findings(&pool, other, 10, 2, &[], &[("a.rs", "@@ -1 +1 @@\n-a\n+b")])
        .await
        .unwrap();
    db::insert_findings(
        &pool,
        id,
        10,
        1,
        &[],
        &[("b.rs", "old"), ("a.rs", "@@ -1 +1 @@")],
    )
    .await
    .unwrap();
    let paths: Vec<String> = db::review_contents(&pool, id)
        .await
        .unwrap()
        .1
        .into_iter()
        .map(|f| f.path)
        .collect();
    assert_eq!(paths, ["a.rs", "b.rs"]);
    db::insert_findings(&pool, id, 10, 1, &[], &[("b.rs", "new")])
        .await
        .unwrap();
    let rows = db::review_contents(&pool, id).await.unwrap().1;
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (rows[0].path.as_str(), rows[0].patch.as_str()),
        ("b.rs", "new")
    );
    assert_eq!(db::review_contents(&pool, other).await.unwrap().1.len(), 1);
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn review_contents_roll_back_together(pool: PgPool) {
    installation(&pool, 1).await;
    let id = enqueue(&pool, 1, 1).await;
    db::insert_findings(
        &pool,
        id,
        10,
        1,
        &[finding("old", true)],
        &[("a.rs", "old")],
    )
    .await
    .unwrap();
    // Duplicate paths fail after the replacement findings have been inserted.
    assert!(
        db::insert_findings(
            &pool,
            id,
            10,
            1,
            &[finding("new", false)],
            &[("a.rs", "new"), ("a.rs", "duplicate")],
        )
        .await
        .is_err()
    );
    let (findings, files, _) = db::review_contents(&pool, id).await.unwrap();
    assert_eq!(findings.len(), 1);
    assert!(findings[0].published);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].patch, "old");
}

#[tokio::test]
async fn api_missing_bearer_token_is_unauthorized_without_io() {
    let settings = Settings::for_test();
    let pool = PgPool::connect_lazy(&settings.database_url).unwrap();
    let app = router(state(pool));
    for path in [
        "/api/v1/me",
        "/api/v1/installations",
        "/api/v1/installations/1",
        "/api/v1/installations/1/reviews",
        "/api/v1/installations/1/vulnerabilities",
        "/api/v1/reviews/00000000-0000-0000-0000-000000000001",
    ] {
        let response = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap(),
            json!({"error": "missing or invalid token"})
        );
    }
    let response = app
        .oneshot(
            Request::patch("/api/v1/installations/1/settings")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn retention_removes_old_and_deleted_reviews_with_their_contents(pool: PgPool) {
    installation(&pool, 1).await;
    installation(&pool, 2).await;
    let expired = enqueue(&pool, 1, 1).await;
    let recent = enqueue(&pool, 1, 2).await;
    let active = enqueue(&pool, 1, 3).await;
    let running = enqueue(&pool, 1, 4).await;
    let legacy = enqueue(&pool, 1, 5).await;
    let deleted = enqueue(&pool, 2, 1).await;
    for id in [expired, recent, active, running, legacy, deleted] {
        db::insert_findings(
            &pool,
            id,
            10,
            1,
            &[finding("retention", true)],
            &[("src/login.rs", "private patch")],
        )
        .await
        .unwrap();
    }
    sqlx::query(
        "UPDATE reviews SET status = 'succeeded',
         created_at = now() - interval '60 days',
         finished_at = CASE WHEN id = $1 THEN now() - interval '31 days' ELSE now() END
         WHERE id = ANY($2)",
    )
    .bind(expired)
    .bind(&[expired, recent][..])
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE reviews SET created_at = now() - interval '60 days' WHERE id = $1")
        .bind(active)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE reviews SET created_at = now() - interval '60 days',
         status = CASE WHEN id = $1 THEN 'running' ELSE 'cancelled' END
         WHERE id = ANY($2)",
    )
    .bind(running)
    .bind(&[running, legacy][..])
    .execute(&pool)
    .await
    .unwrap();
    db::set_installation_state(&pool, 2, false, true)
        .await
        .unwrap();

    assert_eq!(db::prune_reviews(&pool).await.unwrap(), 3);
    for id in [expired, legacy, deleted] {
        assert!(db::review(&pool, id).await.unwrap().is_none());
        let (findings, files, _) = db::review_contents(&pool, id).await.unwrap();
        assert!(findings.is_empty());
        assert!(files.is_empty());
    }
    for id in [recent, active, running] {
        assert!(db::review(&pool, id).await.unwrap().is_some());
        let (findings, files, _) = db::review_contents(&pool, id).await.unwrap();
        assert_eq!(findings.len(), 1);
        assert_eq!(files.len(), 1);
    }
    assert_eq!(db::prune_reviews(&pool).await.unwrap(), 0);
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn runtime_connection_rejects_database_administrator(pool: PgPool) {
    let options = pool.connect_options();
    // SQLx integration tests require a database administrator. Never print its URL.
    use sqlx::ConnectOptions;
    let error = db::connect(options.to_url_lossy().as_str())
        .await
        .unwrap_err();
    assert!(error.to_string().contains("restricted runtime role"));
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn stats_count_the_window_and_fill_every_day(pool: PgPool) {
    installation(&pool, 1).await;
    installation(&pool, 2).await;
    let done = enqueue(&pool, 1, 1).await;
    let failed = enqueue(&pool, 1, 2).await;
    let old = enqueue(&pool, 1, 3).await;
    enqueue(&pool, 1, 4).await;
    enqueue(&pool, 2, 1).await;
    db::insert_findings(
        &pool,
        done,
        10,
        1,
        &[finding("a", true), finding("b", false)],
        &[],
    )
    .await
    .unwrap();
    sqlx::query(
        "UPDATE reviews SET status = 'succeeded', finished_at = created_at + interval '90 seconds'
         WHERE id = $1",
    )
    .bind(done)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE reviews SET status = 'failed', finished_at = now() WHERE id = $1")
        .bind(failed)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE reviews SET created_at = now() - interval '45 days' WHERE id = $1")
        .bind(old)
        .execute(&pool)
        .await
        .unwrap();

    let stats = db::stats(&pool, 1).await.unwrap();
    let t = &stats.totals;
    assert_eq!(
        (t.reviews, t.succeeded, t.failed, t.in_progress),
        (3, 1, 1, 1)
    );
    assert_eq!((t.pull_requests, t.repositories), (3, 1));
    assert_eq!(t.median_duration_secs, Some(90.0));
    assert_eq!((stats.findings, stats.published), (2, 1));
    assert_eq!(stats.severity[0].name, "high");
    assert_eq!(stats.categories[0].count, 2);
    assert_eq!(stats.daily.len(), db::STATS_DAYS as usize);
    let today = stats.daily.last().unwrap();
    assert_eq!((today.reviews, today.failed), (3, 1));
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn pull_filters_and_latest_review_per_pull(pool: PgPool) {
    installation(&pool, 1).await;
    let first = enqueue(&pool, 1, 1).await;
    let other = enqueue(&pool, 1, 2).await;
    let newest = db::enqueue_review(
        &pool,
        &db::NewReview {
            installation_id: 1,
            repo_id: 10,
            repo_full_name: "acme/api",
            pr_number: 1,
            pr_title: "Fix login",
            head_sha: "head2",
            base_sha: "base",
        },
    )
    .await
    .unwrap()
    .unwrap();
    sqlx::query("UPDATE reviews SET created_at = now() - interval '1 hour' WHERE id = $1")
        .bind(first)
        .execute(&pool)
        .await
        .unwrap();

    let timeline = db::list_reviews(&pool, 1, None, Some(("acme/api", 1)), 50)
        .await
        .unwrap();
    let ids: Vec<Uuid> = timeline.iter().map(|r| r.id).collect();
    assert_eq!(ids, [newest, first]);

    let latest = db::latest_reviews(
        &pool,
        1,
        &[
            ("acme/api".into(), 1),
            ("acme/api".into(), 2),
            ("acme/web".into(), 1),
        ],
    )
    .await
    .unwrap();
    let mut ids: Vec<Uuid> = latest.iter().map(|r| r.id).collect();
    ids.sort();
    let mut expected = vec![newest, other];
    expected.sort();
    assert_eq!(ids, expected);
    assert!(
        db::latest_reviews(&pool, 2, &[("acme/api".into(), 1)])
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn agent_models_replace_and_show_only_enabled_agents(pool: PgPool) {
    let model = |id: &str| crate::models::Model {
        id: id.into(),
        name: id.into(),
    };
    db::save_agent_models(&pool, "codex", &[model("old")])
        .await
        .unwrap();
    db::save_agent_models(&pool, "codex", &[model("gpt-6")])
        .await
        .unwrap();
    db::save_agent_models(&pool, "retired", &[model("x")])
        .await
        .unwrap();
    // A failed check keeps the models of the last success.
    db::mark_agent_unavailable(&pool, "codex").await.unwrap();
    let mut state = state(pool);
    let mut settings = Settings::for_test();
    settings.agents = vec![crate::agents::Agent::Codex, crate::agents::Agent::Claude];
    settings.default_agent = crate::agents::Agent::Codex;
    state.settings = Arc::new(settings);
    let key: [u8; 32] = <Sha256 as sha2::Digest>::digest(b"test-token").into();
    state.auth.put(
        key,
        crate::api::Access {
            user: crate::github::User {
                id: 1,
                login: "octocat".into(),
            },
            installations: Default::default(),
        },
    );
    let anonymous = router(state.clone())
        .oneshot(Request::get("/api/v1/agents").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    let response = router(state)
        .oneshot(
            Request::get("/api/v1/agents")
                .header("authorization", "Bearer test-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    let checked_at = body["health"]["codex"]["checked_at"].clone();
    assert!(checked_at.is_string());
    assert_eq!(
        body,
        json!({
            "agents": ["codex", "claude"],
            "default": "codex",
            "models": {"codex": [{"id": "gpt-6", "name": "gpt-6"}], "claude": []},
            "health": {"codex": {"available": false, "checked_at": checked_at}, "claude": null},
        })
    );
}

#[tokio::test]
async fn vulnerability_access_and_page_validation_need_no_external_io() {
    let settings = Settings::for_test();
    let pool = PgPool::connect_lazy(&settings.database_url).unwrap();
    let state = state(pool);
    let key: [u8; 32] = <Sha256 as sha2::Digest>::digest(b"test-token").into();
    state.auth.put(
        key,
        crate::api::Access {
            user: crate::github::User {
                id: 1,
                login: "octocat".into(),
            },
            installations: [(1, false)].into_iter().collect(),
        },
    );
    let app = router(state);
    for (path, status) in [
        (
            "/api/v1/installations/2/vulnerabilities",
            StatusCode::NOT_FOUND,
        ),
        (
            "/api/v1/installations/1/vulnerabilities?page=0",
            StatusCode::BAD_REQUEST,
        ),
        (
            "/api/v1/installations/1/vulnerabilities?page=1000001",
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::get(path)
                    .header("authorization", "Bearer test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{path}");
    }
}

fn with_access(state: &AppState, token: &str, installations: &[(i64, bool)]) {
    let key: [u8; 32] = <Sha256 as sha2::Digest>::digest(token.as_bytes()).into();
    state.auth.put(
        key,
        crate::api::Access {
            user: crate::github::User {
                id: 1,
                login: "octocat".into(),
            },
            installations: installations.iter().copied().collect(),
        },
    );
}

async fn call(state: &AppState, method: &str, path: &str, token: &str) -> (StatusCode, Value) {
    let response = router(state.clone())
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 65536).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

async fn enqueue_sha(pool: &PgPool, sha: &str) -> Uuid {
    db::enqueue_review(
        pool,
        &db::NewReview {
            installation_id: 1,
            repo_id: 10,
            repo_full_name: "acme/api",
            pr_number: 1,
            pr_title: "Fix login",
            head_sha: sha,
            base_sha: "base",
        },
    )
    .await
    .unwrap()
    .unwrap()
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn review_controls_cancel_and_retry_only_valid_reviews(pool: PgPool) {
    installation(&pool, 1).await;
    let first = enqueue_sha(&pool, "head1").await;
    assert!(!db::requeue_review(&pool, first).await.unwrap());
    assert!(db::cancel_review(&pool, first).await.unwrap());
    assert!(!db::cancel_review(&pool, first).await.unwrap());
    let row = db::review(&pool, first).await.unwrap().unwrap().0;
    assert_eq!(
        (row.status.as_str(), row.error.as_deref()),
        ("cancelled", Some("cancelled from the dashboard"))
    );

    assert!(db::requeue_review(&pool, first).await.unwrap());
    let row = db::review(&pool, first).await.unwrap().unwrap().0;
    assert_eq!(
        (row.status.as_str(), row.attempts, row.error),
        ("queued", 0, None)
    );

    // Cancelling a running review takes the lease away from its worker.
    db::claim_review(&pool, "worker", 1).await.unwrap().unwrap();
    db::set_review_agent(&pool, first, "worker", "claude", Some("opus"))
        .await
        .unwrap();
    db::mark_published(&pool, first, 77, &[]).await.unwrap();
    assert!(db::cancel_review(&pool, first).await.unwrap());
    assert!(!db::heartbeat(&pool, first, "worker").await.unwrap());
    // The stopping worker still holds the lease, so a retry must wait.
    assert!(!db::requeue_review(&pool, first).await.unwrap());
    db::finish_review(
        &pool,
        first,
        "worker",
        &db::Finish {
            status: "succeeded",
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        db::review(&pool, first).await.unwrap().unwrap().0.status,
        "cancelled"
    );
    db::release_lock(&pool, first, "other").await.unwrap();
    assert!(!db::requeue_review(&pool, first).await.unwrap());
    db::release_lock(&pool, first, "worker").await.unwrap();
    assert!(db::requeue_review(&pool, first).await.unwrap());
    let (github_review_id, agent): (Option<i64>, Option<String>) =
        sqlx::query_as("SELECT github_review_id, agent FROM reviews WHERE id = $1")
            .bind(first)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((github_review_id, agent), (Some(77), None));

    // A newer commit makes the old review final and blocks its retry.
    let second = enqueue_sha(&pool, "head2").await;
    assert_eq!(
        db::review(&pool, first).await.unwrap().unwrap().0.status,
        "cancelled"
    );
    assert!(!db::requeue_review(&pool, first).await.unwrap());
    sqlx::query("UPDATE reviews SET status = 'failed', error = 'worker lost' WHERE id = $1")
        .bind(second)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!db::requeue_review(&pool, first).await.unwrap());

    let state = state(pool.clone());
    with_access(&state, "admin", &[(1, true)]);
    with_access(&state, "member", &[(1, false)]);
    with_access(&state, "stranger", &[(2, true)]);
    let retry = format!("/api/v1/reviews/{second}/retry");
    let cancel = format!("/api/v1/reviews/{second}/cancel");
    assert_eq!(
        call(&state, "POST", &retry, "stranger").await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&state, "POST", &retry, "member").await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&state, "POST", &cancel, "admin").await.0,
        StatusCode::CONFLICT
    );
    let (status, body) = call(&state, "POST", &retry, "admin").await;
    assert_eq!(
        (status, body["status"].as_str()),
        (StatusCode::OK, Some("queued"))
    );
    assert_eq!(
        call(&state, "POST", &retry, "admin").await.0,
        StatusCode::CONFLICT
    );
    let (status, body) = call(&state, "POST", &cancel, "admin").await;
    assert_eq!(
        (status, body["status"].as_str()),
        (StatusCode::OK, Some("cancelled"))
    );
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn usage_is_stored_and_grouped_by_agent(pool: PgPool) {
    installation(&pool, 1).await;
    let done = enqueue(&pool, 1, 1).await;
    let failed = enqueue(&pool, 1, 2).await;
    for (id, agent) in [(done, "claude"), (failed, "codex")] {
        let job = db::claim_review(&pool, "worker", 5).await.unwrap().unwrap();
        assert_eq!(job.id, id);
        db::set_review_agent(&pool, id, "worker", agent, None)
            .await
            .unwrap();
    }
    db::finish_review(
        &pool,
        done,
        "worker",
        &db::Finish {
            status: "succeeded",
            agent: Some("claude"),
            model: Some("claude-opus-5-5"),
            agent_ms: Some(4_000),
            input_tokens: Some(1_000),
            cached_input_tokens: Some(600),
            output_tokens: Some(50),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db::finish_review(
        &pool,
        failed,
        "worker",
        &db::Finish {
            status: "failed",
            error: Some("agent timed out after 900s"),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let row = db::review(&pool, done).await.unwrap().unwrap().0;
    assert_eq!(
        (
            row.agent_duration_ms,
            row.input_tokens,
            row.cached_input_tokens,
            row.output_tokens
        ),
        (Some(4_000), Some(1_000), Some(600), Some(50))
    );
    let stats = db::stats(&pool, 1).await.unwrap();
    let agents: Vec<(&str, i64, i64, i64, i64, i64)> = stats
        .agents
        .iter()
        .map(|a| {
            (
                a.name.as_str(),
                a.reviews,
                a.succeeded,
                a.failed,
                a.usage_reviews,
                a.input_tokens,
            )
        })
        .collect();
    assert_eq!(
        agents,
        [("claude", 1, 1, 0, 1, 1_000), ("codex", 1, 0, 1, 0, 0)]
    );
    assert_eq!(stats.agents[0].median_agent_secs, Some(4.0));
    assert_eq!(stats.agents[0].models, ["claude-opus-5-5"]);
    assert!(stats.agents[1].models.is_empty());
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn digest_opt_in_claims_once_and_seals_the_url(pool: PgPool) {
    installation(&pool, 1).await;
    installation(&pool, 2).await;
    assert!(db::claim_digest(&pool).await.unwrap().is_none());
    let state = state(pool.clone());
    with_access(&state, "admin", &[(1, true), (2, true)]);
    let patch = |id: i64, body: Value| {
        let state = state.clone();
        async move {
            router(state)
                .oneshot(
                    Request::patch(format!("/api/v1/installations/{id}/settings"))
                        .header("authorization", "Bearer admin")
                        .header("content-type", "application/json")
                        .body(Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap()
                .status()
        }
    };
    for bad in [
        "http://hooks.example.com/x",
        "https://10.0.0.1/x",
        "https://localhost/x",
    ] {
        assert_eq!(
            patch(1, json!({ "digest_webhook_url": bad })).await,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{bad}"
        );
    }
    let url = "https://hooks.example.com/services/secret-path";
    assert_eq!(
        patch(1, json!({ "digest_webhook_url": url })).await,
        StatusCode::OK
    );

    // The database holds only the sealed value and the host.
    let row: String =
        sqlx::query_scalar("SELECT row_to_json(i)::text FROM installations i WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!row.contains("secret-path"), "{row}");
    let job = db::claim_digest(&pool).await.unwrap().unwrap();
    assert_eq!(job.id, 1);
    assert_eq!(
        state
            .webhook_key
            .open(1, &job.digest_webhook_sealed)
            .as_deref(),
        Some(url)
    );
    assert_eq!(state.webhook_key.open(2, &job.digest_webhook_sealed), None);
    assert!(db::claim_digest(&pool).await.unwrap().is_none());
    db::finish_digest(&pool, &job, Err("webhook returned HTTP 404"))
        .await
        .unwrap();
    let i = db::installation(&pool, 1).await.unwrap().unwrap();
    assert_eq!(i.digest_error.as_deref(), Some("webhook returned HTTP 404"));
    assert_eq!(i.digest_webhook_host.as_deref(), Some("hooks.example.com"));
    assert!(i.digest_sent_at.is_none());

    // A failed send waits an hour before the next attempt.
    assert!(db::claim_digest(&pool).await.unwrap().is_none());
    sqlx::query("UPDATE installations SET digest_attempted_at = now() - interval '2 hours'")
        .execute(&pool)
        .await
        .unwrap();
    let job = db::claim_digest(&pool).await.unwrap().unwrap();
    let covered = Utc::now() - chrono::Duration::minutes(5);
    db::finish_digest(&pool, &job, Ok(covered)).await.unwrap();
    let i = db::installation(&pool, 1).await.unwrap().unwrap();
    assert!(i.digest_error.is_none());
    assert_eq!(
        i.digest_sent_at.map(|t| t.timestamp_micros()),
        Some(covered.timestamp_micros()),
        "The next window starts where this read started"
    );
    sqlx::query("UPDATE installations SET digest_attempted_at = now() - interval '2 hours'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(db::claim_digest(&pool).await.unwrap().is_none());

    // A result for an old URL is dropped after the admin changes it, and the
    // new URL gets its first digest at once.
    assert_eq!(
        patch(
            1,
            json!({ "digest_webhook_url": "https://chat.example.org/hooks/other" })
        )
        .await,
        StatusCode::OK
    );
    db::finish_digest(&pool, &job, Err("old")).await.unwrap();
    let i = db::installation(&pool, 1).await.unwrap().unwrap();
    assert!(i.digest_error.is_none() && i.digest_attempted_at.is_none());
    assert!(i.digest_sent_at.is_none());
    assert_eq!(i.digest_webhook_host.as_deref(), Some("chat.example.org"));
    assert_eq!(db::claim_digest(&pool).await.unwrap().unwrap().id, 1);

    let (status, body) = call(&state, "GET", "/api/v1/installations/1", "admin").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["digest"]["enabled"], true);
    assert_eq!(body["digest"]["webhook_host"], "chat.example.org");
    assert!(!body.to_string().contains("hooks/other"));
    assert!(!body.to_string().contains("v1:"));

    assert_eq!(
        patch(1, json!({ "digest_webhook_url": null })).await,
        StatusCode::OK
    );
    let i = db::installation(&pool, 1).await.unwrap().unwrap();
    assert!(i.digest_webhook_sealed.is_none() && i.digest_webhook_host.is_none());
    assert!(i.digest_sent_at.is_none());
    // Leaving the field out keeps the digest.
    assert_eq!(
        patch(2, json!({ "digest_webhook_url": url })).await,
        StatusCode::OK
    );
    assert_eq!(patch(2, json!({ "enabled": false })).await, StatusCode::OK);
    let i = db::installation(&pool, 2).await.unwrap().unwrap();
    assert!(i.digest_webhook_sealed.is_some());
}

#[sqlx::test(migrations = "../../migrations")]
#[ignore = "needs DATABASE_URL"]
async fn sast_results_are_stored_shown_and_reset_on_retry(pool: PgPool) {
    use crocode_core::prompt::SastHint;
    installation(&pool, 1).await;
    let id = enqueue(&pool, 1, 1).await;
    let hint = |rule: &str, line: u32| SastHint {
        path: "app.py".into(),
        line,
        end_line: line,
        severity: "error".into(),
        rule_id: rule.into(),
        message: "Shell injection".into(),
    };
    // Only the worker that holds the review can write its results.
    assert!(
        !db::store_sast(&pool, id, "worker", "completed", &[hint("x", 1)])
            .await
            .unwrap()
    );
    db::claim_review(&pool, "worker", 1).await.unwrap().unwrap();
    assert!(
        !db::store_sast(&pool, id, "stale", "completed", &[hint("x", 1)])
            .await
            .unwrap()
    );
    assert!(
        db::store_sast(
            &pool,
            id,
            "worker",
            "completed",
            &[hint("a", 3), hint("b", 1)]
        )
        .await
        .unwrap()
    );
    assert!(
        db::store_sast(
            &pool,
            id,
            "worker",
            "partial",
            &[hint("c", 9), hint("a", 3)]
        )
        .await
        .unwrap()
    );
    let (_, _, sast) = db::review_contents(&pool, id).await.unwrap();
    assert_eq!(sast.status.as_deref(), Some("partial"));
    let rules: Vec<&str> = sast.results.iter().map(|r| r.rule_id.as_str()).collect();
    assert_eq!(rules, ["c", "a"], "a rerun replaces results in agent order");
    assert!(
        db::store_sast(&pool, id, "worker", "bogus", &[])
            .await
            .is_err(),
        "the status check rejects unknown values"
    );

    let state = state(pool.clone());
    with_access(&state, "admin", &[(1, true)]);
    let (status, body) = call(&state, "GET", &format!("/api/v1/reviews/{id}"), "admin").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["sast"]["status"], "partial");
    assert_eq!(body["sast"]["results"][0]["rule_id"], "c");

    sqlx::query("UPDATE reviews SET status = 'failed', locked_by = NULL WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(db::requeue_review(&pool, id).await.unwrap());
    let (_, _, sast) = db::review_contents(&pool, id).await.unwrap();
    assert!(sast.status.is_none() && sast.results.is_empty());
}
