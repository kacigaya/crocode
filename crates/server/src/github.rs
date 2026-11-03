//! GitHub REST calls through Octocrab.
//!
//! Each review gets its own installation token, scoped to one repository with
//! `contents: read` and `pull_requests: write`. Tokens stay in the worker.

use anyhow::{Context, Result, bail};
use octocrab::Octocrab;
use octocrab::models::AppId;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone)]
pub struct GitHub {
    app: Octocrab,
    api_url: String,
}

/// Client authenticated as one installation, for one repository.
pub struct RepoClient {
    client: Octocrab,
    token: String,
    pub repo: String,
}

impl std::fmt::Debug for RepoClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RepoClient")
            .field("repo", &self.repo)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Deserialize)]
pub struct Pull {
    pub state: String,
    pub draft: Option<bool>,
    pub title: String,
    pub body: Option<String>,
    pub head: GitRef,
    pub base: GitRef,
}

#[derive(Debug, Deserialize)]
pub struct GitRef {
    pub sha: String,
    #[serde(rename = "ref")]
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct PullFile {
    pub filename: String,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    /// Missing for binary files and very large diffs.
    pub patch: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct NewReview {
    pub commit_id: String,
    pub body: String,
    pub event: &'static str,
    pub comments: Vec<NewComment>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NewComment {
    pub path: String,
    pub line: u32,
    pub side: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_side: Option<&'static str>,
    pub body: String,
}

#[derive(Debug, Deserialize)]
struct Created {
    id: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct User {
    pub id: i64,
    pub login: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UserInstallation {
    pub id: i64,
    pub account: Account,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Account {
    pub id: i64,
    pub login: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// `owner/name` with GitHub's allowed characters. Blocks route injection.
pub fn valid_repo_name(name: &str) -> bool {
    let mut parts = name.split('/');
    let ok = |s: Option<&str>| {
        s.is_some_and(|s| {
            !s.is_empty()
                && s != "."
                && s != ".."
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        })
    };
    ok(parts.next()) && ok(parts.next()) && parts.next().is_none()
}

pub fn status_code(err: &octocrab::Error) -> Option<u16> {
    match err {
        octocrab::Error::GitHub { source, .. } => Some(source.status_code.as_u16()),
        _ => None,
    }
}

impl GitHub {
    #[cfg(test)]
    pub fn for_test() -> Self {
        Self {
            app: Octocrab::builder()
                .app(AppId(1), octocrab::EncodingKey::from_secret(b"test-only"))
                .build()
                .unwrap(),
            api_url: "http://127.0.0.1:1".into(),
        }
    }

    pub fn new(app_id: u64, private_key_pem: &[u8], api_url: &str) -> Result<Self> {
        let app = Octocrab::builder()
            .base_uri(api_url)?
            .app_from_rsa_pem(AppId(app_id), private_key_pem)
            .context("parse GitHub App private key")?
            .build()?;
        Ok(Self {
            app,
            api_url: api_url.to_owned(),
        })
    }

    /// Mints a token limited to one repository and the permissions CroCode needs.
    pub async fn repo_client(
        &self,
        installation_id: i64,
        repo_id: i64,
        repo: &str,
    ) -> Result<RepoClient> {
        if !valid_repo_name(repo) {
            bail!("invalid repository name {repo:?}");
        }
        let token = self
            .installation_token(
                installation_id,
                json!({
                    "repository_ids": [repo_id],
                    "permissions": { "contents": "read", "pull_requests": "write" }
                }),
            )
            .await?;
        Ok(RepoClient {
            client: self.token_client(&token)?,
            token,
            repo: repo.to_owned(),
        })
    }

    /// Client for every repository of an installation that can only read
    /// Dependabot alerts. Used by the weekly security digest.
    pub async fn alerts_client(&self, installation_id: i64) -> Result<Octocrab> {
        let token = self
            .installation_token(
                installation_id,
                json!({ "permissions": { "vulnerability_alerts": "read", "metadata": "read" } }),
            )
            .await?;
        self.token_client(&token)
    }

    async fn installation_token(
        &self,
        installation_id: i64,
        body: serde_json::Value,
    ) -> Result<String> {
        #[derive(Deserialize)]
        struct Token {
            token: String,
        }
        let token: Token = self
            .app
            .post(
                format!("/app/installations/{installation_id}/access_tokens"),
                Some(&body),
            )
            .await
            .context("create installation token")?;
        Ok(token.token)
    }

    fn token_client(&self, token: &str) -> Result<Octocrab> {
        Ok(Octocrab::builder()
            .base_uri(self.api_url.as_str())?
            .personal_token(token.to_owned())
            .build()?)
    }

    pub fn user_client(&self, token: &str) -> Result<Octocrab> {
        Ok(Octocrab::builder()
            .base_uri(self.api_url.as_str())?
            .user_access_token(token.to_owned())
            .build()?)
    }
}

impl RepoClient {
    pub fn token(&self) -> &str {
        &self.token
    }

    pub async fn pull(&self, number: i64) -> Result<Pull> {
        Ok(self
            .client
            .get(format!("/repos/{}/pulls/{number}", self.repo), None::<&()>)
            .await?)
    }

    /// Repository size in KiB as reported by GitHub.
    pub async fn size_kb(&self) -> Result<u64> {
        #[derive(Deserialize)]
        struct Repo {
            size: u64,
        }
        let repo: Repo = self
            .client
            .get(format!("/repos/{}", self.repo), None::<&()>)
            .await?;
        Ok(repo.size)
    }

    /// Lists changed files. GitHub returns at most 3000.
    pub async fn files(&self, number: i64, limit: usize) -> Result<Vec<PullFile>> {
        let mut files = Vec::new();
        for page in 1..=30u32 {
            let batch: Vec<PullFile> = self
                .client
                .get(
                    format!("/repos/{}/pulls/{number}/files", self.repo),
                    Some(&[("per_page", 100u32), ("page", page)]),
                )
                .await?;
            let done = batch.len() < 100;
            files.extend(batch);
            if done || files.len() > limit {
                break;
            }
        }
        Ok(files)
    }

    /// Reads a text file at a commit. Returns `None` when it does not exist.
    pub async fn file_text(&self, path: &str, sha: &str) -> Result<Option<String>> {
        #[derive(Deserialize)]
        struct Content {
            content: Option<String>,
            encoding: Option<String>,
        }
        let result: Result<Content, _> = self
            .client
            .get(
                format!("/repos/{}/contents/{path}", self.repo),
                Some(&[("ref", sha)]),
            )
            .await;
        let content = match result {
            Ok(content) => content,
            Err(err) if status_code(&err) == Some(404) => return Ok(None),
            Err(err) => return Err(err.into()),
        };
        if content.encoding.as_deref() != Some("base64") {
            bail!("{path} is not a regular file");
        }
        use base64::Engine;
        let raw: String = content
            .content
            .unwrap_or_default()
            .split_whitespace()
            .collect();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(raw)
            .context("decode file content")?;
        Ok(Some(String::from_utf8(bytes).context("file is not UTF-8")?))
    }

    pub async fn create_review(&self, number: i64, review: &NewReview) -> octocrab::Result<i64> {
        let created: Created = self
            .client
            .post(
                format!("/repos/{}/pulls/{number}/reviews", self.repo),
                Some(review),
            )
            .await?;
        Ok(created.id)
    }
}

pub async fn current_user(client: &Octocrab) -> octocrab::Result<User> {
    client.get("/user", None::<&()>).await
}

pub async fn user_installations(client: &Octocrab) -> octocrab::Result<Vec<UserInstallation>> {
    #[derive(Deserialize)]
    struct Page {
        installations: Vec<UserInstallation>,
    }
    let mut out = Vec::new();
    for page in 1..=10u32 {
        let batch: Page = client
            .get(
                "/user/installations",
                Some(&[("per_page", 100u32), ("page", page)]),
            )
            .await?;
        let done = batch.installations.len() < 100;
        out.extend(batch.installations);
        if done {
            break;
        }
    }
    Ok(out)
}

/// Repositories of one installation that the user can access.
pub async fn user_installation_repos(
    client: &Octocrab,
    installation_id: i64,
) -> octocrab::Result<Vec<String>> {
    #[derive(Deserialize)]
    struct Repo {
        full_name: String,
    }
    #[derive(Deserialize)]
    struct Page {
        repositories: Vec<Repo>,
    }
    let mut out = Vec::new();
    for page in 1..=10u32 {
        let batch: Page = client
            .get(
                format!("/user/installations/{installation_id}/repositories"),
                Some(&[("per_page", 100u32), ("page", page)]),
            )
            .await?;
        let done = batch.repositories.len() < 100;
        out.extend(batch.repositories.into_iter().map(|r| r.full_name));
        if done {
            break;
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenPull {
    pub repo_full_name: String,
    pub number: i64,
    pub title: String,
    pub draft: bool,
    pub author: Option<String>,
    pub author_id: Option<i64>,
    pub comments: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Up to 100 open pull requests in repositories of `owner`, last updated first.
/// The bool is true when GitHub has more results than it returned.
pub async fn search_open_pulls(
    client: &Octocrab,
    owner: &str,
    organization: bool,
) -> Result<(Vec<OpenPull>, bool)> {
    #[derive(Deserialize)]
    struct Author {
        login: String,
        id: i64,
    }
    #[derive(Deserialize)]
    struct Item {
        number: i64,
        title: String,
        draft: Option<bool>,
        user: Option<Author>,
        comments: i64,
        repository_url: String,
        created_at: chrono::DateTime<chrono::Utc>,
        updated_at: chrono::DateTime<chrono::Utc>,
    }
    #[derive(Deserialize)]
    struct Page {
        total_count: u64,
        incomplete_results: bool,
        items: Vec<Item>,
    }
    if !valid_repo_name(&format!("{owner}/x")) {
        bail!("invalid account name");
    }
    let qualifier = if organization { "org" } else { "user" };
    let query = format!("is:pr is:open archived:false {qualifier}:{owner}");
    let page: Page = client
        .get(
            "/search/issues",
            Some(&[
                ("q", query.as_str()),
                ("sort", "updated"),
                ("order", "desc"),
                ("per_page", "100"),
            ]),
        )
        .await?;
    let more = page.incomplete_results || page.total_count > page.items.len() as u64;
    let pulls = page
        .items
        .into_iter()
        .filter_map(|item| {
            // `https://api.github.com/repos/{owner}/{name}`
            let mut parts = item.repository_url.rsplit('/');
            let name = parts.next()?;
            let owner = parts.next()?;
            let repo_full_name = format!("{owner}/{name}");
            valid_repo_name(&repo_full_name).then(|| OpenPull {
                repo_full_name,
                number: item.number,
                title: item.title,
                draft: item.draft.unwrap_or(false),
                author: item.user.as_ref().map(|u| u.login.clone()),
                author_id: item.user.map(|u| u.id),
                comments: item.comments,
                created_at: item.created_at,
                updated_at: item.updated_at,
            })
        })
        .collect();
    Ok((pulls, more))
}

#[derive(Debug, Serialize)]
pub struct PullDetail {
    /// `open`, `closed`, or `merged`.
    pub state: String,
    pub draft: bool,
    pub author: Option<String>,
    pub author_id: Option<i64>,
    pub base_ref: String,
    pub head_ref: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub commits: u64,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// One pull request as the user sees it.
pub async fn user_pull(client: &Octocrab, repo: &str, number: i64) -> Result<PullDetail> {
    #[derive(Deserialize)]
    struct Author {
        login: String,
        id: i64,
    }
    #[derive(Deserialize)]
    struct Raw {
        state: String,
        merged: Option<bool>,
        draft: Option<bool>,
        user: Option<Author>,
        base: GitRef,
        head: GitRef,
        additions: u64,
        deletions: u64,
        changed_files: u64,
        commits: u64,
        created_at: chrono::DateTime<chrono::Utc>,
    }
    if !valid_repo_name(repo) {
        bail!("invalid repository name");
    }
    let raw: Raw = client
        .get(format!("/repos/{repo}/pulls/{number}"), None::<&()>)
        .await?;
    Ok(PullDetail {
        state: if raw.merged == Some(true) {
            "merged".into()
        } else {
            raw.state
        },
        draft: raw.draft.unwrap_or(false),
        author: raw.user.as_ref().map(|u| u.login.clone()),
        author_id: raw.user.map(|u| u.id),
        base_ref: raw.base.name,
        head_ref: raw.head.name,
        additions: raw.additions,
        deletions: raw.deletions,
        changed_files: raw.changed_files,
        commits: raw.commits,
        created_at: raw.created_at,
    })
}

/// True when the user is an active admin of the organization. Needs the
/// app's "Members: read" organization permission; on any error it says no.
pub async fn is_org_admin(client: &Octocrab, org: &str) -> bool {
    #[derive(Deserialize)]
    struct Membership {
        role: String,
        state: String,
    }
    if !valid_repo_name(&format!("{org}/x")) {
        return false;
    }
    let result: octocrab::Result<Membership> = client
        .get(format!("/user/memberships/orgs/{org}"), None::<&()>)
        .await;
    matches!(result, Ok(m) if m.role == "admin" && m.state == "active")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_names() {
        assert!(valid_repo_name("acme/api.rs"));
        assert!(valid_repo_name("a-b/c_d"));
        for bad in [
            "acme",
            "acme/api/x",
            "../x",
            "a/..",
            "a/b?x=1",
            "a/b#",
            "/b",
            "a/",
        ] {
            assert!(!valid_repo_name(bad), "{bad}");
        }
    }

    #[test]
    fn review_comment_json() {
        let c = NewComment {
            path: "a".into(),
            line: 3,
            side: "RIGHT",
            start_line: None,
            start_side: None,
            body: "b".into(),
        };
        let v = serde_json::to_value(&c).unwrap();
        assert!(v.get("start_line").is_none());
        assert_eq!(v["side"], "RIGHT");
    }
}
