//! GitHub webhook receiver.
//!
//! The handler checks the signature before it parses anything, records the
//! delivery ID to drop redeliveries, and only writes queue rows. Reviews run
//! in the worker.

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use hmac::{Hmac, KeyInit, Mac};
use serde::Deserialize;
use sha2::Sha256;
use tracing::{info, warn};

use crate::AppState;
use crate::db;
use crate::github::valid_repo_name;

/// GitHub caps webhook payloads at 25 MB.
pub const MAX_BODY: usize = 25 * 1024 * 1024;

/// Checks `X-Hub-Signature-256` in constant time.
pub fn verify_signature(secret: &[u8], body: &[u8], header: Option<&str>) -> bool {
    let Some(sig) = header.and_then(|h| h.strip_prefix("sha256=")) else {
        return false;
    };
    let Ok(sig) = hex::decode(sig) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret) else {
        return false;
    };
    mac.update(body);
    mac.verify_slice(&sig).is_ok()
}

#[derive(Deserialize)]
struct Account {
    id: i64,
    login: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
struct InstallationRef {
    id: i64,
    account: Option<Account>,
    repository_selection: Option<String>,
}

#[derive(Deserialize)]
struct InstallationEvent {
    action: String,
    installation: InstallationRef,
}

#[derive(Deserialize)]
struct Repository {
    id: i64,
    full_name: String,
    owner: Account,
}

#[derive(Deserialize)]
struct PrRef {
    sha: String,
}

#[derive(Deserialize)]
struct PullRequest {
    number: i64,
    title: String,
    head: PrRef,
    base: PrRef,
}

#[derive(Deserialize)]
struct PullRequestEvent {
    action: String,
    installation: Option<InstallationRef>,
    repository: Repository,
    pull_request: PullRequest,
}

pub async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, &'static str) {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    if !verify_signature(
        &state.settings.github_webhook_secret,
        &body,
        header("x-hub-signature-256"),
    ) {
        warn!("webhook rejected: bad signature");
        return (StatusCode::UNAUTHORIZED, "bad signature");
    }
    let (Some(event), Some(delivery)) = (header("x-github-event"), header("x-github-delivery"))
    else {
        return (StatusCode::BAD_REQUEST, "missing event headers");
    };
    if delivery.len() > 100 {
        return (StatusCode::BAD_REQUEST, "bad delivery id");
    }
    match db::record_delivery(&state.db, delivery, event).await {
        Ok(true) => {}
        Ok(false) => return (StatusCode::OK, "duplicate delivery"),
        Err(err) => {
            warn!(error = %err, "record delivery");
            return (StatusCode::SERVICE_UNAVAILABLE, "database error");
        }
    }

    let result = match event {
        "ping" => Ok("pong"),
        "installation" => on_installation(&state, &body).await,
        "installation_repositories" => on_installation_repositories(&state, &body).await,
        "pull_request" => on_pull_request(&state, &body).await,
        _ => Ok("ignored"),
    };
    match result {
        Ok(message) => {
            info!(event, delivery, message, "webhook handled");
            (StatusCode::ACCEPTED, message)
        }
        Err(err) => {
            warn!(event, delivery, error = %err, "webhook failed");
            // Let GitHub's manual redelivery work after a transient failure.
            let _ = sqlx::query("DELETE FROM webhook_deliveries WHERE id = $1")
                .bind(delivery)
                .execute(&state.db)
                .await;
            (StatusCode::UNPROCESSABLE_ENTITY, "could not process event")
        }
    }
}

async fn upsert(
    state: &AppState,
    i: &InstallationRef,
    fallback: Option<&Account>,
) -> anyhow::Result<()> {
    let Some(account) = i.account.as_ref().or(fallback) else {
        anyhow::bail!("installation has no account");
    };
    db::upsert_installation(
        &state.db,
        &db::InstallationUpsert {
            id: i.id,
            account_id: account.id,
            account_login: &account.login,
            account_type: &account.kind,
            repository_selection: i.repository_selection.as_deref(),
        },
    )
    .await?;
    Ok(())
}

async fn on_installation(state: &AppState, body: &[u8]) -> anyhow::Result<&'static str> {
    let e: InstallationEvent = serde_json::from_slice(body)?;
    match e.action.as_str() {
        "created" | "new_permissions_accepted" => {
            upsert(state, &e.installation, None).await?;
            db::set_installation_state(&state.db, e.installation.id, false, false).await?;
        }
        "unsuspend" => {
            db::set_installation_state(&state.db, e.installation.id, false, false).await?
        }
        "suspend" => db::set_installation_state(&state.db, e.installation.id, true, false).await?,
        "deleted" => db::set_installation_state(&state.db, e.installation.id, false, true).await?,
        _ => return Ok("ignored action"),
    }
    Ok("installation updated")
}

async fn on_installation_repositories(
    state: &AppState,
    body: &[u8],
) -> anyhow::Result<&'static str> {
    let e: InstallationEvent = serde_json::from_slice(body)?;
    upsert(state, &e.installation, None).await?;
    Ok("installation updated")
}

async fn on_pull_request(state: &AppState, body: &[u8]) -> anyhow::Result<&'static str> {
    let e: PullRequestEvent = serde_json::from_slice(body)?;
    let Some(installation) = &e.installation else {
        return Ok("no installation");
    };
    if !valid_repo_name(&e.repository.full_name) {
        anyhow::bail!("bad repository name");
    }
    let pr = &e.pull_request;
    match e.action.as_str() {
        "opened" | "reopened" | "synchronize" | "ready_for_review" => {}
        "closed" | "converted_to_draft" => {
            db::cancel_pr_reviews(&state.db, e.repository.id, pr.number, None).await?;
            return Ok("reviews cancelled");
        }
        _ => return Ok("ignored action"),
    }
    // The repository owner is the installation account. This covers apps
    // installed before Crocode saw the installation event.
    let known = db::installation(&state.db, installation.id).await?;
    if known.is_none() {
        upsert(state, installation, Some(&e.repository.owner)).await?;
    }
    if known.as_ref().is_some_and(|i| i.suspended || !i.enabled) {
        return Ok("installation disabled");
    }
    // Drafts are queued too; the worker checks them against repository config.
    let id = db::enqueue_review(
        &state.db,
        &db::NewReview {
            installation_id: installation.id,
            repo_id: e.repository.id,
            repo_full_name: &e.repository.full_name,
            pr_number: pr.number,
            pr_title: &pr.title,
            head_sha: &pr.head.sha,
            base_sha: &pr.base.sha,
        },
    )
    .await?;
    Ok(if id.is_some() {
        "review queued"
    } else {
        "commit already reviewed"
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sign(secret: &[u8], body: &[u8]) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret).unwrap();
        mac.update(body);
        format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
    }

    #[test]
    fn signature_checks() {
        let secret = b"0123456789abcdef";
        let body = br#"{"zen":"hi"}"#;
        let good = sign(secret, body);
        assert!(verify_signature(secret, body, Some(&good)));
        assert!(!verify_signature(secret, b"{}", Some(&good)));
        assert!(!verify_signature(b"other-secret-123", body, Some(&good)));
        assert!(!verify_signature(secret, body, None));
        assert!(!verify_signature(secret, body, Some("sha1=abc")));
        assert!(!verify_signature(secret, body, Some("sha256=zz")));
    }

    // Matches the documented example in GitHub's "Validating webhook deliveries".
    #[test]
    fn github_documented_vector() {
        let header = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
        assert!(verify_signature(
            b"It's a Secret to Everybody",
            b"Hello, World!",
            Some(header)
        ));
    }
}
