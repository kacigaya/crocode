//! REST API for the dashboard. See `docs/api.md`.
//!
//! The caller sends the GitHub user access token of the signed-in user. The
//! API asks GitHub which installations that user can access. GitHub stays
//! the source of truth for access; the API stores no user tokens.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{FromRequestParts, Path, Query, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::agents::{Agent, valid_model};
use crate::{AppState, db, github};

const CACHE_TTL: Duration = Duration::from_secs(60);
const CACHE_MAX: usize = 10_000;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me", get(me))
        .route("/agents", get(agents))
        .route("/installations", get(list_installations))
        .route("/installations/{id}", get(get_installation))
        .route("/installations/{id}/settings", patch(update_settings))
        .route("/installations/{id}/reviews", get(list_reviews))
        .route("/installations/{id}/stats", get(installation_stats))
        .route("/installations/{id}/pulls", get(open_pulls))
        .route("/installations/{id}/vulnerabilities", get(vulnerabilities))
        .route("/reviews/{id}", get(get_review))
        .route("/reviews/{id}/pull", get(review_pull))
        .route("/reviews/{id}/retry", post(retry_review))
        .route("/reviews/{id}/cancel", post(cancel_review))
}

pub struct ApiError(StatusCode, String);

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self(status, message.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!(error = %err, "database error");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
    }
}

type ApiResult<T> = Result<Json<T>, ApiError>;

/// What one user token may access, cached briefly.
#[derive(Clone)]
pub struct Access {
    pub user: github::User,
    /// Installation ID to "can change settings".
    pub installations: HashMap<i64, bool>,
}

/// Small in-memory cache. Entries expire after [`CACHE_TTL`].
pub struct TtlCache<K, V> {
    entries: Mutex<HashMap<K, (Instant, V)>>,
}

impl<K, V> Default for TtlCache<K, V> {
    fn default() -> Self {
        Self {
            entries: Mutex::default(),
        }
    }
}

impl<K: Eq + std::hash::Hash, V: Clone> TtlCache<K, V> {
    pub(crate) fn get(&self, key: &K) -> Option<V> {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries
            .get(key)
            .filter(|(at, _)| at.elapsed() < CACHE_TTL)
            .map(|(_, value)| value.clone())
    }

    pub(crate) fn put(&self, key: K, value: V) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if entries.len() >= CACHE_MAX {
            entries.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
        }
        if entries.len() < CACHE_MAX {
            entries.insert(key, (Instant::now(), value));
        }
    }
}

/// Keyed by token hash, so raw tokens are not kept in memory.
pub type AuthCache = TtlCache<[u8; 32], Access>;
/// Open pull requests by token hash and installation. GitHub search allows
/// 30 requests per minute for each user.
pub type PullCache = TtlCache<([u8; 32], i64), OpenPulls>;

/// The bearer token of the request, for calls to GitHub as the user.
/// Handlers that take it must also take [`Access`], which checks the token.
pub struct UserToken(String);

impl UserToken {
    fn key(&self) -> [u8; 32] {
        Sha256::digest(self.0.as_bytes()).into()
    }
}

fn bearer(parts: &Parts) -> Option<&str> {
    parts
        .headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty() && t.len() < 512)
}

impl FromRequestParts<AppState> for UserToken {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _: &AppState) -> Result<Self, ApiError> {
        bearer(parts)
            .map(|token| Self(token.to_owned()))
            .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "missing or invalid token"))
    }
}

impl FromRequestParts<AppState> for Access {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let unauthorized = || ApiError::new(StatusCode::UNAUTHORIZED, "missing or invalid token");
        let token = bearer(parts).ok_or_else(unauthorized)?;
        // Key the cache by hash so raw tokens are not kept in memory.
        let key: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        if let Some(access) = state.auth.get(&key) {
            return Ok(access);
        }

        let client = state
            .github
            .user_client(token)
            .map_err(|_| unauthorized())?;
        let user = github::current_user(&client)
            .await
            .map_err(|err| match github::status_code(&err) {
                Some(401 | 403) => unauthorized(),
                _ => ApiError::new(StatusCode::BAD_GATEWAY, "GitHub request failed"),
            })?;
        let list = github::user_installations(&client)
            .await
            .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "GitHub request failed"))?;
        let mut installations = HashMap::new();
        for i in list {
            let admin = if i.account.kind == "Organization" {
                github::is_org_admin(&client, &i.account.login).await
            } else {
                i.account.id == user.id
            };
            installations.insert(i.id, admin);
        }
        let access = Access {
            user,
            installations,
        };
        state.auth.put(key, access.clone());
        Ok(access)
    }
}

impl Access {
    fn require(&self, installation_id: i64) -> Result<bool, ApiError> {
        self.installations
            .get(&installation_id)
            .copied()
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "installation not found"))
    }
}

async fn me(access: Access) -> ApiResult<github::User> {
    Ok(Json(access.user))
}

/// Needs a token: OpenCode model lists show which providers have keys.
async fn agents(State(state): State<AppState>, _: Access) -> ApiResult<serde_json::Value> {
    let names: Vec<&str> = state.settings.agents.iter().map(|a| a.name()).collect();
    // Only enabled agents. An agent without a stored list maps to `[]`, and
    // to `null` health until its first check.
    let stored: HashMap<String, db::AgentModels> = db::agent_models(&state.db)
        .await?
        .into_iter()
        .map(|row| (row.agent.clone(), row))
        .collect();
    let mut models = serde_json::Map::new();
    let mut health = serde_json::Map::new();
    for name in &names {
        let row = stored.get(*name);
        models.insert(
            name.to_string(),
            row.map_or(json!([]), |r| r.models.clone()),
        );
        health.insert(
            name.to_string(),
            row.map_or(
                serde_json::Value::Null,
                |r| json!({ "available": r.available, "checked_at": r.checked_at }),
            ),
        );
    }
    Ok(Json(json!({
        "agents": names,
        "default": state.settings.default_agent.name(),
        "models": models,
        "health": health,
    })))
}

#[derive(Serialize)]
struct InstallationView {
    id: i64,
    /// GitHub user or organization ID. Clients use it for avatars.
    account_id: i64,
    account_login: String,
    account_type: String,
    repository_selection: String,
    suspended: bool,
    created_at: DateTime<Utc>,
    settings: SettingsView,
    digest: DigestView,
    can_admin: bool,
}

#[derive(Serialize)]
struct SettingsView {
    enabled: bool,
    agent: Option<String>,
    model: Option<String>,
}

/// The webhook URL is a secret. Only its host is shown.
#[derive(Serialize)]
struct DigestView {
    enabled: bool,
    webhook_host: Option<String>,
    sent_at: Option<DateTime<Utc>>,
    attempted_at: Option<DateTime<Utc>>,
    error: Option<String>,
}

fn view(i: db::Installation, can_admin: bool) -> InstallationView {
    InstallationView {
        id: i.id,
        account_id: i.account_id,
        account_login: i.account_login,
        account_type: i.account_type,
        repository_selection: i.repository_selection,
        suspended: i.suspended,
        created_at: i.created_at,
        settings: SettingsView {
            enabled: i.enabled,
            agent: i.agent,
            model: i.model,
        },
        digest: DigestView {
            enabled: i.digest_webhook_sealed.is_some(),
            webhook_host: i.digest_webhook_host,
            sent_at: i.digest_sent_at,
            attempted_at: i.digest_attempted_at,
            error: i.digest_error,
        },
        can_admin,
    }
}

async fn list_installations(
    State(state): State<AppState>,
    access: Access,
) -> ApiResult<Vec<InstallationView>> {
    let ids: Vec<i64> = access.installations.keys().copied().collect();
    let rows = db::installations(&state.db, &ids).await?;
    Ok(Json(
        rows.into_iter()
            .map(|i| {
                let admin = access.installations[&i.id];
                view(i, admin)
            })
            .collect(),
    ))
}

async fn load_installation(
    state: &AppState,
    access: &Access,
    id: i64,
) -> Result<(db::Installation, bool), ApiError> {
    let can_admin = access.require(id)?;
    let installation = db::installation(&state.db, id)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "installation not found"))?;
    Ok((installation, can_admin))
}

async fn get_installation(
    State(state): State<AppState>,
    access: Access,
    Path(id): Path<i64>,
) -> ApiResult<InstallationView> {
    let (installation, can_admin) = load_installation(&state, &access, id).await?;
    Ok(Json(view(installation, can_admin)))
}

/// `Some(None)` means "set to null"; `None` means "leave unchanged".
fn double_option<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SettingsPatch {
    enabled: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    agent: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    model: Option<Option<String>>,
    /// `null` turns the weekly security digest off.
    #[serde(default, deserialize_with = "double_option")]
    digest_webhook_url: Option<Option<String>>,
}

async fn update_settings(
    State(state): State<AppState>,
    access: Access,
    Path(id): Path<i64>,
    Json(patch): Json<SettingsPatch>,
) -> ApiResult<InstallationView> {
    let (current, can_admin) = load_installation(&state, &access, id).await?;
    if !can_admin {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "admin access required",
        ));
    }
    let unprocessable = |m: &str| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, m);
    let agent = match patch.agent {
        Some(Some(name)) => {
            let agent: Agent = name.parse().map_err(|_| unprocessable("unknown agent"))?;
            if !state.settings.agents.contains(&agent) {
                return Err(unprocessable("agent is not enabled on this server"));
            }
            Some(agent.name().to_owned())
        }
        Some(None) => None,
        None => current.agent,
    };
    let model = match patch.model {
        Some(Some(model)) if model.trim().is_empty() => None,
        Some(Some(model)) => {
            if !valid_model(&model) {
                return Err(unprocessable("invalid model name"));
            }
            Some(model)
        }
        Some(None) => None,
        None => current.model,
    };
    let sealed = match &patch.digest_webhook_url {
        Some(Some(url)) => {
            crate::digest::validate_webhook_url(url).map_err(unprocessable)?;
            let host = crate::digest::webhook_host(url)
                .ok_or_else(|| unprocessable("invalid webhook URL"))?;
            let sealed = state.webhook_key.seal(id, url).map_err(|err| {
                tracing::error!(error = err, "seal webhook URL");
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
            })?;
            Some(Some((sealed, host)))
        }
        Some(None) => Some(None),
        None => None,
    };
    let digest = sealed.as_ref().map(|value| {
        value
            .as_ref()
            .map(|(sealed, host)| (sealed.as_str(), host.as_str()))
    });
    let enabled = patch.enabled.unwrap_or(current.enabled);
    db::update_settings(
        &state.db,
        id,
        enabled,
        agent.as_deref(),
        model.as_deref(),
        digest,
    )
    .await?;
    tracing::info!(installation = id, user = %access.user.login, "settings updated");
    let (installation, can_admin) = load_installation(&state, &access, id).await?;
    Ok(Json(view(installation, can_admin)))
}

#[derive(Deserialize)]
struct ReviewQuery {
    limit: Option<i64>,
    before: Option<DateTime<Utc>>,
    /// With `pr`, lists the reviews of one pull request.
    repo: Option<String>,
    pr: Option<i32>,
}

async fn list_reviews(
    State(state): State<AppState>,
    access: Access,
    Path(id): Path<i64>,
    Query(q): Query<ReviewQuery>,
) -> ApiResult<Vec<db::ReviewRow>> {
    access.require(id)?;
    let limit = q.limit.unwrap_or(50).clamp(1, 100);
    let pull = match (q.repo.as_deref(), q.pr) {
        (None, None) => None,
        (Some(repo), Some(pr)) if github::valid_repo_name(repo) && pr > 0 => Some((repo, pr)),
        _ => {
            return Err(ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "repo and pr must be set together",
            ));
        }
    };
    Ok(Json(
        db::list_reviews(&state.db, id, q.before, pull, limit).await?,
    ))
}

async fn installation_stats(
    State(state): State<AppState>,
    access: Access,
    Path(id): Path<i64>,
) -> ApiResult<db::Stats> {
    access.require(id)?;
    Ok(Json(db::stats(&state.db, id).await?))
}

#[derive(Clone, Serialize)]
pub struct OpenPulls {
    /// True when the account has more open pull requests than listed.
    truncated: bool,
    pulls: Vec<OpenPull>,
}

#[derive(Clone, Serialize)]
struct OpenPull {
    #[serde(flatten)]
    pull: github::OpenPull,
    /// The newest CroCode review of this pull request, if any.
    review: Option<LatestReview>,
}

#[derive(Clone, Serialize)]
struct LatestReview {
    id: Uuid,
    status: String,
    head_sha: String,
    finding_count: i64,
    created_at: DateTime<Utc>,
}

fn github_error(err: impl std::fmt::Display) -> ApiError {
    tracing::warn!(error = %err, "GitHub request for the dashboard failed");
    ApiError::new(StatusCode::BAD_GATEWAY, "GitHub request failed")
}

/// Open pull requests in the installation repositories that the user can access.
async fn open_pulls(
    State(state): State<AppState>,
    access: Access,
    token: UserToken,
    Path(id): Path<i64>,
) -> ApiResult<OpenPulls> {
    let (installation, _) = load_installation(&state, &access, id).await?;
    let key = (token.key(), id);
    if let Some(cached) = state.pulls.get(&key) {
        return Ok(Json(cached));
    }
    let client = state.github.user_client(&token.0).map_err(github_error)?;
    let repos: std::collections::HashSet<String> = github::user_installation_repos(&client, id)
        .await
        .map_err(github_error)?
        .into_iter()
        .collect();
    let (found, more) = github::search_open_pulls(
        &client,
        &installation.account_login,
        installation.account_type == "Organization",
    )
    .await
    .map_err(github_error)?;
    // Search also finds public repositories outside the installation.
    let found: Vec<github::OpenPull> = found
        .into_iter()
        .filter(|p| repos.contains(&p.repo_full_name))
        .collect();
    let keys: Vec<(String, i32)> = found
        .iter()
        .filter_map(|p| Some((p.repo_full_name.clone(), i32::try_from(p.number).ok()?)))
        .collect();
    let mut latest: HashMap<(String, i32), db::ReviewRow> =
        db::latest_reviews(&state.db, id, &keys)
            .await?
            .into_iter()
            .map(|r| ((r.repo_full_name.clone(), r.pr_number), r))
            .collect();
    let pulls = found
        .into_iter()
        .map(|pull| {
            let review = i32::try_from(pull.number)
                .ok()
                .and_then(|n| latest.remove(&(pull.repo_full_name.clone(), n)))
                .map(|r| LatestReview {
                    id: r.id,
                    status: r.status,
                    head_sha: r.head_sha,
                    finding_count: r.finding_count,
                    created_at: r.created_at,
                });
            OpenPull { pull, review }
        })
        .collect();
    let result = OpenPulls {
        truncated: more,
        pulls,
    };
    state.pulls.put(key, result.clone());
    Ok(Json(result))
}

/// Live pull request details from GitHub for a review page.
async fn review_pull(
    State(state): State<AppState>,
    access: Access,
    token: UserToken,
    Path(id): Path<Uuid>,
) -> ApiResult<github::PullDetail> {
    let not_found = || ApiError::new(StatusCode::NOT_FOUND, "review not found");
    let (review, _) = db::review(&state.db, id).await?.ok_or_else(not_found)?;
    if !access.installations.contains_key(&review.installation_id) {
        return Err(not_found());
    }
    let client = state.github.user_client(&token.0).map_err(github_error)?;
    let pull = github::user_pull(&client, &review.repo_full_name, review.pr_number.into())
        .await
        .map_err(|err| {
            match err
                .downcast_ref::<octocrab::Error>()
                .and_then(github::status_code)
            {
                Some(403 | 404) => not_found(),
                _ => github_error(err),
            }
        })?;
    Ok(Json(pull))
}

#[derive(Serialize)]
struct ReviewDetail {
    review: db::ReviewRow,
    summary: Option<String>,
    findings: Vec<db::FindingRow>,
    /// PR patches of the files with findings. Empty for older reviews.
    files: Vec<db::ReviewFileRow>,
    /// OpenGrep results that the agent received as hints.
    sast: db::Sast,
}

async fn get_review(
    State(state): State<AppState>,
    access: Access,
    Path(id): Path<Uuid>,
) -> ApiResult<ReviewDetail> {
    let not_found = || ApiError::new(StatusCode::NOT_FOUND, "review not found");
    let (review, summary) = db::review(&state.db, id).await?.ok_or_else(not_found)?;
    // Same answer as a missing review, so IDs from other tenants leak nothing.
    if !access.installations.contains_key(&review.installation_id) {
        return Err(not_found());
    }
    let (findings, files, sast) = db::review_contents(&state.db, id).await?;
    Ok(Json(ReviewDetail {
        review,
        summary,
        findings,
        files,
        sast,
    }))
}

#[derive(Deserialize)]
struct VulnerabilityQuery {
    #[serde(default = "first_page")]
    page: u32,
}

fn first_page() -> u32 {
    1
}

async fn vulnerabilities(
    State(state): State<AppState>,
    access: Access,
    token: UserToken,
    Path(id): Path<i64>,
    Query(query): Query<VulnerabilityQuery>,
) -> ApiResult<crate::vulnerabilities::Report> {
    access.require(id)?;
    if query.page == 0 || query.page > 1_000_000 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "invalid page"));
    }
    let client = state.github.user_client(&token.0).map_err(github_error)?;
    let report = crate::vulnerabilities::list(
        &client,
        id,
        query.page,
        &state.vulnerability_checks,
        token.key(),
    )
    .await
    .map_err(github_error)?;
    Ok(Json(report))
}

/// Loads a review that the user can see and whose installation they administer.
async fn admin_review(state: &AppState, access: &Access, id: Uuid) -> Result<(), ApiError> {
    let not_found = || ApiError::new(StatusCode::NOT_FOUND, "review not found");
    let (review, _) = db::review(&state.db, id).await?.ok_or_else(not_found)?;
    match access.installations.get(&review.installation_id) {
        None => Err(not_found()),
        Some(false) => Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "admin access required",
        )),
        Some(true) => Ok(()),
    }
}

async fn updated_review(state: &AppState, id: Uuid) -> ApiResult<db::ReviewRow> {
    let (review, _) = db::review(&state.db, id)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "review not found"))?;
    Ok(Json(review))
}

async fn retry_review(
    State(state): State<AppState>,
    access: Access,
    Path(id): Path<Uuid>,
) -> ApiResult<db::ReviewRow> {
    admin_review(&state, &access, id).await?;
    if !db::requeue_review(&state.db, id).await? {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "only the newest failed or cancelled review of an idle pull request can be retried; \
             a cancelled agent may still be stopping, so try again in a minute",
        ));
    }
    tracing::info!(review = %id, user = %access.user.login, "review retried");
    updated_review(&state, id).await
}

async fn cancel_review(
    State(state): State<AppState>,
    access: Access,
    Path(id): Path<Uuid>,
) -> ApiResult<db::ReviewRow> {
    admin_review(&state, &access, id).await?;
    if !db::cancel_review(&state.db, id).await? {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "only queued or running reviews can be cancelled",
        ));
    }
    tracing::info!(review = %id, user = %access.user.login, "review cancelled");
    updated_review(&state, id).await
}
