//! Opt-in weekly security digest.
//!
//! An installation admin sets an HTTPS webhook URL. Every 7 days the worker
//! reads the Dependabot alerts of the installation with a read-only token and
//! posts a Slack-compatible message (`{"text": ...}`) to that URL.
//!
//! The URL is a secret and can point anywhere, so the worker only connects to
//! public addresses. It resolves the host once, rejects private, loopback,
//! link-local, and other special addresses, and connects to the checked
//! address. It sends one request and follows no redirects. Error messages
//! never contain the URL.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::http::Uri;
use chrono::{DateTime, Utc};
use octocrab::{Octocrab, Page};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::task::JoinSet;
use tokio_rustls::rustls;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::github::valid_repo_name;
use crate::vulnerabilities::{Advisory, CoverageStatus, Dependency, Vulnerability};
use crate::{AppState, db};

/// How often the worker looks for due digests.
const POLL: Duration = Duration::from_secs(10 * 60);
const PERIOD_DAYS: i64 = 7;
/// Longest window after failed sends.
const MAX_WINDOW_DAYS: i64 = 30;
const MAX_REPOS: usize = 500;
const PARALLEL_REPOS: usize = 4;
const REPO_TIMEOUT: Duration = Duration::from_secs(30);
const NETWORK_TIMEOUT: Duration = Duration::from_secs(15);
/// Stays below the one-hour retry delay in `db::claim_digest`, so a slow
/// digest is never claimed and sent twice.
const DELIVER_TIMEOUT: Duration = Duration::from_secs(45 * 60);
/// Items listed per section. Counts always cover every alert.
const LIST_ITEMS: usize = 5;

/// Days an open alert may stay open before the digest calls it overdue.
pub fn deadline_days(severity: &str) -> Option<i64> {
    match severity {
        "critical" => Some(15),
        "high" => Some(30),
        "medium" => Some(90),
        "low" => Some(180),
        _ => None,
    }
}

fn severity_rank(severity: &str) -> usize {
    ["critical", "high", "medium", "low"]
        .iter()
        .position(|s| *s == severity)
        .unwrap_or(4)
}

/// Accepts `https://<public host name>[:443]/<path>` only. IP literals,
/// credentials, other ports, and single-label or local names are rejected.
pub fn validate_webhook_url(url: &str) -> Result<(), &'static str> {
    let invalid = "invalid webhook URL";
    if url.len() > 2048 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(invalid);
    }
    let uri: Uri = url.parse().map_err(|_| invalid)?;
    if uri.scheme_str() != Some("https") {
        return Err("webhook URL must use https");
    }
    let authority = uri.authority().ok_or(invalid)?;
    if authority.as_str().contains('@') {
        return Err("webhook URL must not contain credentials");
    }
    if authority.port_u16().is_some_and(|port| port != 443) {
        return Err("webhook URL must use port 443");
    }
    let host = authority.host().trim_end_matches('.').to_ascii_lowercase();
    let public_name = host.contains('.')
        && host.parse::<IpAddr>().is_err()
        && !host.starts_with('[')
        && ![".local", ".localhost", ".internal", ".home.arpa"]
            .iter()
            .any(|suffix| host.ends_with(suffix));
    if !public_name {
        return Err("webhook URL must use a public host name");
    }
    Ok(())
}

/// The host of a stored webhook URL, for display. The rest is secret.
pub fn webhook_host(url: &str) -> Option<String> {
    let uri: Uri = url.parse().ok()?;
    Some(uri.host()?.to_ascii_lowercase())
}

/// True for globally routable unicast addresses.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return public_v4(v4);
            }
            let first = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                // Site-local, documentation, NAT64, and IPv4-compatible ranges.
                || first & 0xffc0 == 0xfec0
                || (first == 0x2001 && v6.segments()[1] == 0x0db8)
                || (first == 0x0064 && v6.segments()[1] == 0xff9b)
                || v6.segments()[..6].iter().all(|s| *s == 0))
        }
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || a == 0
        || a >= 240
        || (a == 100 && (64..128).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 198 && (18..20).contains(&b)))
}

#[derive(Debug, Deserialize)]
pub struct DigestAlert {
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub fixed_at: Option<DateTime<Utc>>,
    pub dependency: Dependency,
    pub security_advisory: Advisory,
    pub security_vulnerability: Vulnerability,
}

/// Why GitHub did not return the alerts of a repository.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadError {
    /// 401, 403, or 404: no access, or alerts are off. Retrying does not help.
    NoAccess,
    /// Timeout, rate limit, or server error. The digest waits and retries.
    Temporary,
}

/// Open and recently fixed alerts of one repository.
pub struct RepoAlerts {
    pub repo: String,
    pub alerts: Result<(Vec<DigestAlert>, Vec<DigestAlert>), ReadError>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Entry {
    pub repo: String,
    pub advisory: String,
    pub package: String,
    pub severity: String,
    pub days_open: i64,
}

#[derive(Debug)]
pub struct Digest {
    pub since: DateTime<Utc>,
    pub until: DateTime<Utc>,
    pub repositories_read: usize,
    pub repositories_failed: usize,
    /// Alerts created in the window, open or fixed since.
    pub new: Vec<Entry>,
    /// Alerts fixed in the window.
    pub fixed: Vec<Entry>,
    /// Open alerts older than their severity deadline.
    pub overdue: Vec<Entry>,
}

fn entry(repo: &str, alert: &DigestAlert, now: DateTime<Utc>) -> Entry {
    let advisory = &alert.security_advisory;
    Entry {
        repo: repo.to_owned(),
        advisory: advisory
            .cve_id
            .clone()
            .unwrap_or_else(|| advisory.ghsa_id.clone()),
        package: alert.dependency.package.name.clone(),
        severity: alert.security_vulnerability.severity.clone(),
        days_open: (now - alert.created_at).num_days(),
    }
}

/// Builds the digest from open alerts and recently fixed alerts.
pub fn summarize(repos: &[RepoAlerts], since: DateTime<Utc>, now: DateTime<Utc>) -> Digest {
    let mut digest = Digest {
        since,
        until: now,
        repositories_read: 0,
        repositories_failed: 0,
        new: Vec::new(),
        fixed: Vec::new(),
        overdue: Vec::new(),
    };
    for repo in repos {
        let Ok((open, fixed)) = &repo.alerts else {
            digest.repositories_failed += 1;
            continue;
        };
        digest.repositories_read += 1;
        for alert in open {
            if alert.created_at >= since {
                digest.new.push(entry(&repo.repo, alert, now));
            }
            let entry = entry(&repo.repo, alert, now);
            if deadline_days(&entry.severity).is_some_and(|days| entry.days_open > days) {
                digest.overdue.push(entry);
            }
        }
        for alert in fixed {
            if alert.fixed_at.is_some_and(|at| at >= since && at <= now) {
                if alert.created_at >= since {
                    digest.new.push(entry(&repo.repo, alert, now));
                }
                digest.fixed.push(entry(&repo.repo, alert, now));
            }
        }
    }
    let order = |a: &Entry, b: &Entry| {
        severity_rank(&a.severity)
            .cmp(&severity_rank(&b.severity))
            .then(b.days_open.cmp(&a.days_open))
            .then(a.repo.cmp(&b.repo))
            .then(a.advisory.cmp(&b.advisory))
    };
    digest.new.sort_by(order);
    digest.fixed.sort_by(order);
    digest.overdue.sort_by(order);
    digest
}

/// Slack `mrkdwn` needs `&`, `<`, and `>` escaped. This also stops `<!channel>`
/// mentions from repository or package names.
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('`', "'")
}

fn by_severity(entries: &[Entry]) -> String {
    let mut parts = Vec::new();
    for severity in ["critical", "high", "medium", "low"] {
        let count = entries.iter().filter(|e| e.severity == severity).count();
        if count > 0 {
            parts.push(format!("{severity} {count}"));
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" ({})", parts.join(", "))
    }
}

pub fn render(account: &str, digest: &Digest) -> String {
    let mut text = format!(
        "*CroCode weekly security digest for {}*\n{} to {} · {} {} read",
        escape(account),
        digest.since.format("%Y-%m-%d"),
        digest.until.format("%Y-%m-%d"),
        digest.repositories_read,
        if digest.repositories_read == 1 {
            "repository"
        } else {
            "repositories"
        },
    );
    if digest.repositories_failed > 0 {
        text.push_str(&format!(
            " · {} could not be read",
            digest.repositories_failed
        ));
    }
    text.push_str(&format!(
        "\n\n• New alerts: {}{}\n• Fixed alerts: {}\n• Overdue open alerts: {}{}\n",
        digest.new.len(),
        by_severity(&digest.new),
        digest.fixed.len(),
        digest.overdue.len(),
        by_severity(&digest.overdue),
    ));
    let section = |text: &mut String, title: &str, entries: &[Entry], overdue: bool| {
        if entries.is_empty() {
            return;
        }
        text.push_str(&format!("\n*{title}*\n"));
        for e in entries.iter().take(LIST_ITEMS) {
            text.push_str(&format!(
                "• `{}` {} · {} · {}",
                escape(&e.advisory),
                e.severity,
                escape(&e.repo),
                escape(&e.package),
            ));
            if overdue && let Some(days) = deadline_days(&e.severity) {
                text.push_str(&format!(" · open {} days (limit {days})", e.days_open));
            }
            text.push('\n');
        }
        if entries.len() > LIST_ITEMS {
            text.push_str(&format!("…and {} more\n", entries.len() - LIST_ITEMS));
        }
    };
    section(&mut text, "New alerts", &digest.new, false);
    section(&mut text, "Overdue alerts", &digest.overdue, true);
    text.push_str(
        "\nDeadlines: critical 15 days, high 30, medium 90, low 180. \
         Source: GitHub Dependabot alerts on default branches. This is not a full security scan.",
    );
    text
}

/// Reads alert pages until `more` returns false for a page.
async fn alert_pages<T: DeserializeOwned>(
    client: &Octocrab,
    repo: &str,
    query: &[(&str, &str)],
    more: impl Fn(&[T]) -> bool,
) -> Result<Vec<T>> {
    anyhow::ensure!(valid_repo_name(repo), "invalid repository name");
    let mut page: Page<T> = client
        .get(format!("/repos/{repo}/dependabot/alerts"), Some(query))
        .await?;
    let mut result = Vec::new();
    loop {
        let keep_going = more(&page.items);
        result.append(&mut page.items);
        if !keep_going {
            break;
        }
        match client.get_page::<T>(&page.next).await? {
            Some(next) => page = next,
            None => break,
        }
    }
    Ok(result)
}

async fn repo_alerts(
    client: &Octocrab,
    repo: &str,
    since: DateTime<Utc>,
) -> Result<(Vec<DigestAlert>, Vec<DigestAlert>)> {
    let open = alert_pages(
        client,
        repo,
        &[("state", "open"), ("per_page", "100")],
        |_| true,
    )
    .await?;
    // Newest updates first. `fixed_at` is never after `updated_at`, so the
    // read stops at the first page that ends before the window.
    let fixed = alert_pages(
        client,
        repo,
        &[
            ("state", "fixed"),
            ("sort", "updated"),
            ("direction", "desc"),
            ("per_page", "100"),
        ],
        |items: &[DigestAlert]| items.last().is_some_and(|a| a.updated_at >= since),
    )
    .await?;
    Ok((open, fixed))
}

/// Reads alerts of up to [`MAX_REPOS`] installation repositories.
pub async fn collect(client: &Octocrab, since: DateTime<Utc>) -> Result<Vec<RepoAlerts>> {
    #[derive(Deserialize)]
    struct Repository {
        full_name: String,
    }
    #[derive(Deserialize)]
    struct Repositories {
        repositories: Vec<Repository>,
    }
    let mut names = Vec::new();
    for page in 1..=MAX_REPOS.div_ceil(100) as u32 {
        let batch: Repositories = client
            .get(
                "/installation/repositories",
                Some(&[("per_page", 100u32), ("page", page)]),
            )
            .await
            .context("list installation repositories")?;
        let done = batch.repositories.len() < 100;
        names.extend(batch.repositories.into_iter().map(|r| r.full_name));
        if done {
            break;
        }
    }
    names.truncate(MAX_REPOS);
    let limit = Arc::new(tokio::sync::Semaphore::new(PARALLEL_REPOS));
    let mut tasks = JoinSet::new();
    for repo in names {
        let client = client.clone();
        let limit = limit.clone();
        tasks.spawn(async move {
            let _permit = limit.acquire_owned().await;
            let alerts = match tokio::time::timeout(
                REPO_TIMEOUT,
                repo_alerts(&client, &repo, since),
            )
            .await
            {
                Ok(Ok(alerts)) => Ok(alerts),
                Ok(Err(err)) => {
                    warn!(%repo, error = %format!("{err:#}"), "digest: read alerts");
                    match crate::vulnerabilities::failure_status(&err) {
                        CoverageStatus::AccessDenied | CoverageStatus::Unavailable => {
                            Err(ReadError::NoAccess)
                        }
                        _ => Err(ReadError::Temporary),
                    }
                }
                Err(_) => {
                    warn!(%repo, "digest: alert read timed out");
                    Err(ReadError::Temporary)
                }
            };
            RepoAlerts { repo, alerts }
        });
    }
    let mut repos = Vec::new();
    while let Some(result) = tasks.join_next().await {
        repos.push(result?);
    }
    repos.sort_by(|a, b| a.repo.cmp(&b.repo));
    Ok(repos)
}

/// Writes one HTTP/1.1 POST and returns the response status code.
async fn post<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    host: &str,
    path: &str,
    body: &str,
) -> std::io::Result<u16> {
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: crocode\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).await?;
    stream.flush().await?;
    let mut head = Vec::new();
    let mut buf = [0u8; 512];
    while !head.windows(2).any(|w| w == b"\r\n") && head.len() < 4096 {
        let n = stream.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        head.extend_from_slice(&buf[..n]);
    }
    let line = String::from_utf8_lossy(&head);
    line.strip_prefix("HTTP/1.")
        .and_then(|rest| rest.split(' ').nth(1))
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| std::io::Error::other("invalid HTTP response"))
}

/// Posts `{"text": ...}` to the webhook. Errors never contain the URL.
pub async fn send(url: &str, text: &str) -> Result<(), String> {
    validate_webhook_url(url).map_err(str::to_owned)?;
    let uri: Uri = url.parse().map_err(|_| "invalid webhook URL".to_owned())?;
    let host = uri.host().unwrap_or_default().to_owned();
    let path = uri.path_and_query().map_or("/", |p| p.as_str()).to_owned();
    let addrs: Vec<SocketAddr> = tokio::time::timeout(
        NETWORK_TIMEOUT,
        tokio::net::lookup_host((host.as_str(), 443)),
    )
    .await
    .map_err(|_| "webhook host lookup timed out".to_owned())?
    .map_err(|_| "webhook host did not resolve".to_owned())?
    .collect();
    // Every address must be public, so DNS cannot mix in an internal target.
    if addrs.is_empty() || !addrs.iter().all(|a| is_public(a.ip())) {
        return Err("webhook host must resolve only to public addresses".into());
    }
    // Try each checked address, so an IPv6 answer on an IPv4-only host still works.
    let mut tcp = None;
    for addr in &addrs {
        if let Ok(Ok(stream)) =
            tokio::time::timeout(NETWORK_TIMEOUT, tokio::net::TcpStream::connect(addr)).await
        {
            tcp = Some(stream);
            break;
        }
    }
    let tcp = tcp.ok_or_else(|| "webhook connection failed".to_owned())?;
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| "TLS setup failed".to_owned())?
    .with_root_certificates(roots)
    .with_no_client_auth();
    let name = rustls::pki_types::ServerName::try_from(host.clone())
        .map_err(|_| "invalid webhook host".to_owned())?;
    let body = serde_json::json!({ "text": text }).to_string();
    let status = tokio::time::timeout(NETWORK_TIMEOUT, async {
        let tls = tokio_rustls::TlsConnector::from(Arc::new(config))
            .connect(name, tcp)
            .await
            .map_err(|_| "webhook TLS handshake failed".to_owned())?;
        post(tls, &host, &path, &body)
            .await
            .map_err(|_| "webhook request failed".to_owned())
    })
    .await
    .map_err(|_| "webhook timed out".to_owned())??;
    if (200..300).contains(&status) {
        Ok(())
    } else {
        Err(format!("webhook returned HTTP {status}"))
    }
}

/// Returns the start of the alert read on success.
async fn deliver(state: &AppState, job: &db::DigestJob) -> Result<DateTime<Utc>, String> {
    let now = Utc::now();
    let since = job
        .digest_sent_at
        .map_or(now - chrono::Duration::days(PERIOD_DAYS), |sent| {
            sent.max(now - chrono::Duration::days(MAX_WINDOW_DAYS))
        });
    let client = state.github.alerts_client(job.id).await.map_err(|err| {
        warn!(installation = job.id, error = %format!("{err:#}"), "digest: token");
        "GitHub token request failed; check the Dependabot alerts permission".to_owned()
    })?;
    let repos = collect(&client, since).await.map_err(|err| {
        warn!(installation = job.id, error = %format!("{err:#}"), "digest: repositories");
        "GitHub repository list failed".to_owned()
    })?;
    // Sending now would move the window past changes in these repositories.
    let temporary = repos
        .iter()
        .filter(|r| r.alerts.as_ref().err() == Some(&ReadError::Temporary))
        .count();
    if temporary > 0 {
        return Err(format!(
            "{temporary} {} could not be read for now",
            if temporary == 1 {
                "repository"
            } else {
                "repositories"
            }
        ));
    }
    let digest = summarize(&repos, since, now);
    // The admin may have turned the digest off or changed the URL during the read.
    match db::installation(&state.db, job.id).await {
        Ok(Some(i))
            if !i.suspended
                && i.digest_webhook_url.as_deref() == Some(job.digest_webhook_url.as_str()) => {}
        Ok(_) => return Err("digest settings changed before sending".into()),
        Err(_) => return Err("database error before sending".into()),
    }
    send(
        &job.digest_webhook_url,
        &render(&job.account_login, &digest),
    )
    .await?;
    Ok(now)
}

/// Sends due digests. Runs in every worker; claims keep sends unique.
pub async fn run(state: AppState, shutdown: CancellationToken) {
    loop {
        loop {
            if shutdown.is_cancelled() {
                return;
            }
            let job = match db::claim_digest(&state.db).await {
                Ok(Some(job)) => job,
                Ok(None) => break,
                Err(err) => {
                    warn!(error = %err, "claim digest");
                    break;
                }
            };
            let result = tokio::select! {
                result = tokio::time::timeout(DELIVER_TIMEOUT, deliver(&state, &job)) => {
                    result.unwrap_or_else(|_| Err("digest timed out".to_owned()))
                }
                _ = shutdown.cancelled() => return,
            };
            match &result {
                Ok(_) => info!(installation = job.id, "security digest sent"),
                Err(message) => warn!(installation = job.id, %message, "security digest failed"),
            }
            if let Err(err) = db::finish_digest(
                &state.db,
                &job,
                result.as_ref().copied().map_err(String::as_str),
            )
            .await
            {
                warn!(error = %err, "save digest result");
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(POLL) => {}
            _ = shutdown.cancelled() => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::OriginalUri;
    use axum::response::IntoResponse;
    use axum::{Router, routing::get};
    use serde_json::json;

    #[test]
    fn webhook_urls_must_be_public_https() {
        for good in [
            "https://hooks.slack.com/services/T0/B0/xyz",
            "https://discord.com/api/webhooks/1/abc/slack",
            "https://chat.example.org:443/hooks/abc",
        ] {
            assert_eq!(validate_webhook_url(good), Ok(()), "{good}");
        }
        for bad in [
            "http://hooks.slack.com/x",
            "https://user:pass@hooks.slack.com/x",
            "https://hooks.slack.com:8443/x",
            "https://127.0.0.1/x",
            "https://[::1]/x",
            "https://localhost/x",
            "https://printer.local/x",
            "https://metadata.internal/x",
            "https://hooks.slack.com/a b",
            "https://hooks.slack.com/a\r\nX: y",
            "not a url",
        ] {
            assert!(validate_webhook_url(bad).is_err(), "{bad}");
        }
        assert_eq!(
            webhook_host("https://Hooks.Slack.com/services/secret").as_deref(),
            Some("hooks.slack.com")
        );
    }

    #[test]
    fn only_global_addresses_are_public() {
        for ip in [
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "127.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "255.255.255.255",
            "198.18.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:10.0.0.1",
            "64:ff9b::a00:1",
            "2001:db8::1",
        ] {
            assert!(!is_public(ip.parse().unwrap()), "{ip}");
        }
        for ip in [
            "1.1.1.1",
            "140.82.112.3",
            "2606:4700::1111",
            "::ffff:1.1.1.1",
        ] {
            assert!(is_public(ip.parse().unwrap()), "{ip}");
        }
    }

    fn alert(
        severity: &str,
        cve: &str,
        created: DateTime<Utc>,
        fixed: Option<DateTime<Utc>>,
    ) -> DigestAlert {
        serde_json::from_value(alert_json(severity, cve, created, fixed)).unwrap()
    }

    fn alert_json(
        severity: &str,
        cve: &str,
        created: DateTime<Utc>,
        fixed: Option<DateTime<Utc>>,
    ) -> serde_json::Value {
        json!({
            "created_at": created,
            "updated_at": fixed.unwrap_or(created),
            "fixed_at": fixed,
            "dependency": {"package": {"ecosystem": "npm", "name": "left<pad>"}, "manifest_path": "package.json", "scope": "runtime"},
            "security_advisory": {"ghsa_id": "GHSA-x", "cve_id": cve, "summary": "s"},
            "security_vulnerability": {"severity": severity, "vulnerable_version_range": "< 2", "first_patched_version": null}
        })
    }

    #[test]
    fn digest_counts_new_fixed_and_overdue_alerts() {
        let now = DateTime::from_timestamp(100 * 86_400, 0).unwrap();
        let day = |n: i64| now - chrono::Duration::days(n);
        let since = day(7);
        let repos = [
            RepoAlerts {
                repo: "acme/api".into(),
                alerts: Ok((
                    vec![
                        alert("critical", "CVE-1", day(2), None),
                        alert("high", "CVE-2", day(31), None),
                        alert("high", "CVE-3", day(29), None),
                        alert("low", "CVE-4", day(200), None),
                    ],
                    vec![
                        alert("medium", "CVE-5", day(3), Some(day(1))),
                        alert("medium", "CVE-6", day(60), Some(day(6))),
                        alert("medium", "CVE-7", day(60), Some(day(8))),
                    ],
                )),
            },
            RepoAlerts {
                repo: "acme/denied".into(),
                alerts: Err(ReadError::NoAccess),
            },
        ];
        let digest = summarize(&repos, since, now);
        assert_eq!(
            (digest.repositories_read, digest.repositories_failed),
            (1, 1)
        );
        let ids = |e: &[Entry]| e.iter().map(|e| e.advisory.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&digest.new), ["CVE-1", "CVE-5"]);
        assert_eq!(ids(&digest.fixed), ["CVE-6", "CVE-5"]);
        assert_eq!(ids(&digest.overdue), ["CVE-2", "CVE-4"]);

        let text = render("acme<!channel>", &digest);
        assert!(text.contains("acme&lt;!channel&gt;"));
        assert!(!text.contains("<!channel>"));
        assert!(text.contains("left&lt;pad&gt;"));
        assert!(text.contains("New alerts: 2 (critical 1, medium 1)"));
        assert!(text.contains("Fixed alerts: 2"));
        assert!(text.contains("open 31 days (limit 30)"));
        assert!(text.contains("1 could not be read"));
    }

    #[tokio::test]
    async fn post_reads_the_status_and_sends_one_request() {
        let (client, mut server) = tokio::io::duplex(4096);
        let reply = tokio::spawn(async move {
            let mut buf = vec![0u8; 1024];
            let n = server.read(&mut buf).await.unwrap();
            server
                .write_all(b"HTTP/1.1 204 No Content\r\nX: y\r\n\r\n")
                .await
                .unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        let status = post(client, "hooks.example.com", "/a?b=c", r#"{"text":"hi"}"#)
            .await
            .unwrap();
        assert_eq!(status, 204);
        let request = reply.await.unwrap();
        assert!(request.starts_with("POST /a?b=c HTTP/1.1\r\nHost: hooks.example.com\r\n"));
        assert!(request.ends_with("\r\n\r\n{\"text\":\"hi\"}"));
    }

    #[tokio::test]
    async fn send_refuses_private_targets_before_connecting() {
        // `localhost` fails validation; a public-looking name that resolves
        // to loopback fails the address check.
        assert!(send("https://localhost/x", "t").await.is_err());
        let err = send("https://localtest.me/x", "t").await.unwrap_err();
        assert!(
            err == "webhook host must resolve only to public addresses"
                || err == "webhook host did not resolve"
                || err == "webhook host lookup timed out",
            "{err}"
        );
    }

    #[tokio::test]
    async fn collect_reads_open_and_recent_fixed_alerts() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let now = Utc::now();
        let old = now - chrono::Duration::days(20);
        let next =
            format!("<{origin}/repos/acme/api/dependabot/alerts?state=fixed&page=2>; rel=\"next\"");
        let app = Router::new().fallback(get(move |OriginalUri(uri): OriginalUri| {
            let next = next.clone();
            async move {
                let query = uri.query().unwrap_or_default().to_owned();
                match uri.path() {
                    "/installation/repositories" => axum::Json(json!({"total_count": 3,
                        "repositories": [{"full_name": "acme/api"}, {"full_name": "acme/gone"}, {"full_name": "acme/limited"}]}))
                    .into_response(),
                    "/repos/acme/api/dependabot/alerts" if query.contains("state=open") => {
                        axum::Json(json!([alert_json("high", "CVE-1", now, None)])).into_response()
                    }
                    "/repos/acme/api/dependabot/alerts" if query.contains("page=2") => {
                        panic!("read past the window")
                    }
                    "/repos/acme/api/dependabot/alerts" => {
                        assert!(query.contains("sort=updated"));
                        (
                            [("link", next)],
                            axum::Json(json!([alert_json("low", "CVE-2", old, Some(old))])),
                        )
                            .into_response()
                    }
                    "/repos/acme/limited/dependabot/alerts" => {
                        axum::http::StatusCode::TOO_MANY_REQUESTS.into_response()
                    }
                    _ => axum::http::StatusCode::NOT_FOUND.into_response(),
                }
            }
        }));
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = Octocrab::builder()
            .base_uri(&origin)
            .unwrap()
            .personal_token("test".to_owned())
            .add_retry_config(octocrab::service::middleware::retry::RetryConfig::None)
            .build()
            .unwrap();
        let repos = collect(&client, now - chrono::Duration::days(7))
            .await
            .unwrap();
        assert_eq!(repos.len(), 3);
        let (open, fixed) = repos[0].alerts.as_ref().unwrap();
        assert_eq!((open.len(), fixed.len()), (1, 1));
        assert_eq!(repos[1].alerts.as_ref().err(), Some(&ReadError::NoAccess));
        assert_eq!(repos[2].alerts.as_ref().err(), Some(&ReadError::Temporary));
        server.abort();
    }
}
