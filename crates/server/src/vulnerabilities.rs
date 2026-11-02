//! Live Dependabot alerts, scoped to repositories visible to the user.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Utc};

use octocrab::{Octocrab, Page};
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

use crate::github::valid_repo_name;

const REPOS_PER_PAGE: u32 = 5;

#[derive(Deserialize)]
struct Repository {
    full_name: String,
}

#[derive(Deserialize)]
struct Repositories {
    total_count: u64,
    repositories: Vec<Repository>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ExploitProbability {
    pub percentage: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Advisory {
    pub ghsa_id: String,
    pub cve_id: Option<String>,
    pub summary: String,
    pub epss: Option<ExploitProbability>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Package {
    pub ecosystem: String,
    pub name: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Dependency {
    pub package: Package,
    pub manifest_path: String,
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PatchedVersion {
    pub identifier: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Vulnerability {
    pub severity: String,
    pub vulnerable_version_range: String,
    pub first_patched_version: Option<PatchedVersion>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Alert {
    pub number: u64,
    pub dependency: Dependency,
    pub security_advisory: Advisory,
    pub security_vulnerability: Vulnerability,
}

type CheckKey = ([u8; 32], i64, String);

/// Successful reads only. Token hashes isolate users without retaining tokens.
#[derive(Default)]
pub struct CheckHistory(Mutex<HashMap<CheckKey, DateTime<Utc>>>);

impl CheckHistory {
    fn record(&self, key: CheckKey, at: DateTime<Utc>, success: bool) -> Option<DateTime<Utc>> {
        let mut entries = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if success {
            if entries.len() >= 10_000
                && !entries.contains_key(&key)
                && let Some(oldest) = entries
                    .iter()
                    .min_by_key(|(_, at)| **at)
                    .map(|(key, _)| key.clone())
            {
                entries.remove(&oldest);
            }
            // Concurrent reads may finish in a different order.
            let previous = entries.entry(key).or_insert(at);
            *previous = (*previous).max(at);
            Some(*previous)
        } else {
            entries.get(&key).copied()
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CoverageStatus {
    Readable,
    AccessDenied,
    Unavailable,
    RateLimited,
    TimedOut,
    Failed,
}

#[derive(Debug, Serialize)]
pub struct RepositoryAlerts {
    pub repo_full_name: String,
    /// Null means inaccessible or failed, never zero vulnerabilities.
    pub alerts: Option<Vec<Alert>>,
    pub coverage: CoverageStatus,
    pub checked_at: DateTime<Utc>,
    pub last_success_at: Option<DateTime<Utc>>,
}

fn failure_status(error: &anyhow::Error) -> CoverageStatus {
    let Some(octocrab::Error::GitHub { source, .. }) = error.downcast_ref::<octocrab::Error>()
    else {
        return CoverageStatus::Failed;
    };
    let limited = source.status_code.as_u16() == 429
        || source.status_code.as_u16() == 403
            && source.headers.as_ref().is_some_and(|headers| {
                headers
                    .get("x-ratelimit-remaining")
                    .is_some_and(|v| v == "0")
                    || headers.contains_key("retry-after")
            });
    if limited {
        return CoverageStatus::RateLimited;
    }
    match source.status_code.as_u16() {
        401 | 403 => CoverageStatus::AccessDenied,
        404 => CoverageStatus::Unavailable,
        _ => CoverageStatus::Failed,
    }
}

#[derive(Debug, Serialize)]
pub struct Report {
    pub repositories: Vec<RepositoryAlerts>,
    pub total_repositories: u64,
    pub next_page: Option<u32>,
}

async fn alerts(client: &Octocrab, repo: &str) -> anyhow::Result<Vec<Alert>> {
    anyhow::ensure!(valid_repo_name(repo), "invalid repository name");
    let mut page: Page<Alert> = client
        .get(
            format!("/repos/{repo}/dependabot/alerts"),
            Some(&[("state", "open"), ("per_page", "100")]),
        )
        .await?;
    let mut result = Vec::new();
    loop {
        result.append(&mut page.items);
        match client.get_page::<Alert>(&page.next).await? {
            Some(next) => page = next,
            None => break,
        }
    }
    Ok(result)
}

pub async fn list(
    client: &Octocrab,
    installation: i64,
    page: u32,
    history: &CheckHistory,
    user_key: [u8; 32],
) -> anyhow::Result<Report> {
    let repos: Repositories = client
        .get(
            format!("/user/installations/{installation}/repositories"),
            Some(&[("per_page", REPOS_PER_PAGE), ("page", page)]),
        )
        .await?;
    let next_page = if u64::from(page) * u64::from(REPOS_PER_PAGE) < repos.total_count {
        Some(page + 1)
    } else {
        None
    };
    let mut tasks = JoinSet::new();
    for repo in repos.repositories {
        let client = client.clone();
        tasks.spawn(async move {
            let found =
                tokio::time::timeout(Duration::from_secs(12), alerts(&client, &repo.full_name))
                    .await;
            let (alerts, coverage) = match found {
                Ok(Ok(alerts)) => (Some(alerts), CoverageStatus::Readable),
                Ok(Err(error)) => (None, failure_status(&error)),
                Err(_) => (None, CoverageStatus::TimedOut),
            };
            RepositoryAlerts {
                repo_full_name: repo.full_name,
                alerts,
                coverage,
                checked_at: Utc::now(),
                last_success_at: None,
            }
        });
    }
    let mut repositories = Vec::new();
    while let Some(result) = tasks.join_next().await {
        let mut result = result?;
        result.last_success_at = history.record(
            (user_key, installation, result.repo_full_name.clone()),
            result.checked_at,
            result.coverage == CoverageStatus::Readable,
        );
        repositories.push(result);
    }
    repositories.sort_by(|a, b| a.repo_full_name.cmp(&b.repo_full_name));
    Ok(Report {
        repositories,
        total_repositories: repos.total_count,
        next_page,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router, extract::OriginalUri, http::StatusCode, response::IntoResponse, routing::get,
    };
    use serde_json::json;

    fn alert(number: u64, cve: Option<&str>) -> serde_json::Value {
        json!({
            "number": number,
            "dependency": {"package": {"ecosystem": "npm", "name": "example"}, "manifest_path": "bun.lock", "scope": null},
            "security_advisory": {"ghsa_id": "GHSA-test", "cve_id": cve, "summary": "Test advisory"},
            "security_vulnerability": {"severity": "high", "vulnerable_version_range": "< 2", "first_patched_version": null}
        })
    }

    #[tokio::test]
    async fn lists_only_user_repositories_and_follows_alert_pagination() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let next =
            format!("<{origin}/repos/acme/api/dependabot/alerts?after=cursor>; rel=\"next\"");
        let app = Router::new().fallback(get(move |OriginalUri(uri): OriginalUri| {
            let next = next.clone();
            async move {
                match uri.path() {
                    "/user/installations/1/repositories" => {
                        assert!(uri.query().unwrap().contains("per_page=5"));
                        axum::Json(json!({"total_count": 6, "repositories": [
                            {"full_name": "acme/api"}, {"full_name": "acme/denied"}, {"full_name": "acme/empty"}
                        ]})).into_response()
                    }
                    "/repos/acme/api/dependabot/alerts" if uri.query().unwrap().contains("after=cursor") => {
                        axum::Json(json!([alert(2, None)])).into_response()
                    }
                    "/repos/acme/api/dependabot/alerts" => {
                        assert!(uri.query().unwrap().contains("state=open"));
                        ([("link", next)], axum::Json(json!([alert(1, Some("CVE-2026-1234"))]))).into_response()
                    }
                    "/repos/acme/empty/dependabot/alerts" => axum::Json(json!([])).into_response(),
                    "/repos/acme/denied/dependabot/alerts" => StatusCode::FORBIDDEN.into_response(),
                    _ => panic!("unexpected route {uri}"),
                }
            }
        }));
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = Octocrab::builder()
            .base_uri(&origin)
            .unwrap()
            .personal_token("test".to_owned())
            .build()
            .unwrap();
        let history = CheckHistory::default();
        let report = list(&client, 1, 1, &history, [0; 32]).await.unwrap();
        assert_eq!(report.next_page, Some(2));
        assert_eq!(report.total_repositories, 6);
        assert_eq!(report.repositories.len(), 3);
        let alerts = report.repositories[0].alerts.as_ref().unwrap();
        assert_eq!(alerts.len(), 2);
        assert_eq!(
            alerts[0].security_advisory.cve_id.as_deref(),
            Some("CVE-2026-1234")
        );
        assert!(alerts[1].security_advisory.cve_id.is_none());
        assert!(
            alerts[0]
                .security_vulnerability
                .first_patched_version
                .is_none()
        );
        assert!(report.repositories[1].alerts.is_none());
        assert_eq!(
            report.repositories[1].coverage,
            CoverageStatus::AccessDenied
        );
        assert!(report.repositories[1].last_success_at.is_none());
        assert_eq!(report.repositories[0].coverage, CoverageStatus::Readable);
        assert_eq!(
            report.repositories[0].last_success_at,
            Some(report.repositories[0].checked_at)
        );
        assert!(report.repositories[2].alerts.as_ref().unwrap().is_empty());
        let last = list(&client, 1, 2, &history, [0; 32]).await.unwrap();
        assert_eq!(last.next_page, None);
        server.abort();
    }

    #[test]
    fn success_history_preserves_failures_and_isolates_tokens_and_installations() {
        let history = CheckHistory::default();
        let key = ([1; 32], 1, "acme/api".to_owned());
        let first = DateTime::from_timestamp(100, 0).unwrap();
        let later = DateTime::from_timestamp(200, 0).unwrap();
        assert_eq!(history.record(key.clone(), first, false), None);
        assert_eq!(history.record(key.clone(), later, true), Some(later));
        assert_eq!(history.record(key.clone(), first, true), Some(later));
        assert_eq!(history.record(key, later, false), Some(later));
        assert_eq!(
            history.record(([2; 32], 1, "acme/api".to_owned()), later, false),
            None
        );
        assert_eq!(
            history.record(([1; 32], 2, "acme/api".to_owned()), later, false),
            None
        );
    }

    #[test]
    fn success_history_evicts_the_oldest_entry_at_capacity() {
        let history = CheckHistory::default();
        for n in 0..10_001 {
            history.record(
                ([0; 32], n, "acme/api".to_owned()),
                DateTime::from_timestamp(n, 0).unwrap(),
                true,
            );
        }
        assert_eq!(history.0.lock().unwrap().len(), 10_000);
        assert_eq!(
            history.record(([0; 32], 0, "acme/api".to_owned()), Utc::now(), false),
            None
        );
    }

    #[tokio::test]
    async fn failure_status_keeps_permission_errors_distinct_from_rate_limits() {
        use octocrab::service::middleware::retry::RetryConfig;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new().fallback(get(|OriginalUri(uri): OriginalUri| async move {
            let (status, headers) = match uri.path() {
                "/limited" => (StatusCode::FORBIDDEN, vec![("x-ratelimit-remaining", "0")]),
                "/retry" => (StatusCode::FORBIDDEN, vec![("retry-after", "1")]),
                "/429" => (StatusCode::TOO_MANY_REQUESTS, vec![]),
                "/missing" => (StatusCode::NOT_FOUND, vec![]),
                "/missing-with-limit-header" => {
                    (StatusCode::NOT_FOUND, vec![("x-ratelimit-remaining", "0")])
                }
                "/denied" => (StatusCode::FORBIDDEN, vec![]),
                _ => (StatusCode::BAD_GATEWAY, vec![]),
            };
            let mut response =
                (status, axum::Json(json!({"message": "test error"}))).into_response();
            for (name, value) in headers {
                response.headers_mut().insert(
                    axum::http::HeaderName::from_static(name),
                    axum::http::HeaderValue::from_static(value),
                );
            }
            response
        }));
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = Octocrab::builder()
            .base_uri(&origin)
            .unwrap()
            .add_retry_config(RetryConfig::None)
            .build()
            .unwrap();
        for (path, expected) in [
            ("/limited", CoverageStatus::RateLimited),
            ("/retry", CoverageStatus::RateLimited),
            ("/429", CoverageStatus::RateLimited),
            ("/missing", CoverageStatus::Unavailable),
            ("/missing-with-limit-header", CoverageStatus::Unavailable),
            ("/denied", CoverageStatus::AccessDenied),
            ("/failed", CoverageStatus::Failed),
        ] {
            let error = client
                .get::<serde_json::Value, _, ()>(path, None)
                .await
                .unwrap_err();
            assert_eq!(failure_status(&error.into()), expected, "{path}");
        }
        server.abort();
    }

    #[test]
    fn advisory_epss_is_optional_and_keeps_probability_units() {
        let base = json!({"ghsa_id": "GHSA-test", "cve_id": null, "summary": "test"});
        assert!(
            serde_json::from_value::<Advisory>(base.clone())
                .unwrap()
                .epss
                .is_none()
        );
        for (value, expected) in [
            (json!(null), None),
            (json!({"percentage": null}), Some(None)),
            (json!({"percentage": 0}), Some(Some(0.0))),
            (json!({"percentage": 0.00045}), Some(Some(0.00045))),
        ] {
            let mut input = base.clone();
            input["epss"] = value;
            let advisory: Advisory = serde_json::from_value(input).unwrap();
            assert_eq!(advisory.epss.map(|epss| epss.percentage), expected);
        }
    }

    #[tokio::test]
    async fn rejects_repo_route_injection() {
        let client = Octocrab::default();
        assert!(alerts(&client, "acme/api?x").await.is_err());
    }
}
