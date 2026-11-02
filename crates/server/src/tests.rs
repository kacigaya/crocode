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
    db::cancel_pr_reviews(&pool, 10, 1, None).await.unwrap();
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
async fn findings_replace_on_retry_and_dedupe_only_published_in_same_pr(pool: PgPool) {
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
        &[finding("old", true), finding("unpublished", false)],
        &[],
    )
    .await
    .unwrap();
    assert_eq!(db::review_contents(&pool, id).await.unwrap().0.len(), 2);
    assert_eq!(
        db::published_fingerprints(&pool, 10, 1).await.unwrap(),
        ["old".into()].into()
    );
    assert!(
        db::published_fingerprints(&pool, 20, 1)
            .await
            .unwrap()
            .is_empty()
    );
    db::insert_findings(&pool, id, 10, 1, &[finding("new", true)], &[])
        .await
        .unwrap();
    let rows = db::review_contents(&pool, id).await.unwrap().0;
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (
            rows[0].path.as_str(),
            rows[0].start_line,
            rows[0].line,
            rows[0].published
        ),
        ("src/login.rs", Some(3), 4, true)
    );
    assert_eq!(
        db::published_fingerprints(&pool, 10, 1).await.unwrap(),
        ["new".into()].into()
    );
    assert_eq!(
        db::review_contents(&pool, other_pr).await.unwrap().0.len(),
        1
    );
    db::insert_findings(&pool, id, 10, 1, &[], &[])
        .await
        .unwrap();
    assert!(db::review_contents(&pool, id).await.unwrap().0.is_empty());
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
    let (findings, files) = db::review_contents(&pool, id).await.unwrap();
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
        let (findings, files) = db::review_contents(&pool, id).await.unwrap();
        assert!(findings.is_empty());
        assert!(files.is_empty());
    }
    for id in [recent, active, running] {
        assert!(db::review(&pool, id).await.unwrap().is_some());
        let (findings, files) = db::review_contents(&pool, id).await.unwrap();
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
