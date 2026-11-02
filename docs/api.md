# REST API

The Rust API listens on port 8080. The dashboard calls it from the server side only.

## Authentication

Send the GitHub user access token of the signed-in user:

```
Authorization: Bearer <github user access token>
```

The API calls `GET /user/installations` on GitHub to find the installations the user can access. It caches the result for 60 seconds. The API never stores user tokens.

Errors use this shape:

```json
{ "error": "message" }
```

Status codes: `401` for a missing or bad token, `403` for no access, `404` for unknown IDs, `422` for bad input.

## Endpoints

### `GET /healthz`

No auth. Returns `ok`.

### `GET /api/v1/me`

```json
{ "id": 1, "login": "octocat" }
```

### `GET /api/v1/agents`

Agents that this server can run, and the models that each agent CLI reports.

```json
{
  "agents": ["claude", "codex"],
  "default": "claude",
  "models": {
    "claude": [{ "id": "opus", "name": "opus" }],
    "codex": [{ "id": "gpt-6", "name": "GPT-6" }]
  }
}
```

The worker detects models at start and every 6 hours. It runs each list
command in the sandbox:

- Claude Code: the aliases named in `claude --help`. Claude Code has no list command.
- Codex: `codex debug models`, listed models only. Codex gets no credentials for this command.
- OpenCode: `opencode models`. OpenCode gets the provider keys, so the list shows configured providers.

An agent maps to `[]` until its first detection. The list is a suggestion.
Settings accept any valid model name.

### `GET /api/v1/installations`

Installations that the user can access and that exist in the database.

```json
[
  {
    "id": 123,
    "account_id": 456,
    "account_login": "acme",
    "account_type": "Organization",
    "repository_selection": "selected",
    "suspended": false,
    "created_at": "2026-11-01T10:00:00Z",
    "settings": { "enabled": true, "agent": "claude", "model": null },
    "can_admin": true
  }
]
```

`account_id` is the GitHub user or organization ID.
`can_admin` is true when the user owns the account or is an organization admin.
`settings.agent` and `settings.model` are `null` when the installation uses the server default.

### `GET /api/v1/installations/{id}`

One installation, same shape as above.

### `PATCH /api/v1/installations/{id}/settings`

Needs `can_admin`. All fields are optional. Set `model` to `null` to use the agent default.

```json
{ "enabled": true, "agent": "codex", "model": "gpt-5.1-codex" }
```

Returns the updated installation.

### `GET /api/v1/installations/{id}/reviews?limit=50&before=<RFC 3339 time>`

Newest first. `limit` is 1 to 100, default 50.
Add `repo=<owner/name>&pr=<number>` to list the reviews of one pull request.
Set both or neither. Otherwise the API returns `422`.

```json
[
  {
    "id": "6f1c0b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    "installation_id": 123,
    "repo_full_name": "acme/api",
    "pr_number": 42,
    "pr_title": "Add login",
    "head_sha": "abc123...",
    "status": "succeeded",
    "agent": "claude",
    "model": null,
    "attempts": 1,
    "finding_count": 3,
    "error": null,
    "created_at": "2026-11-01T10:00:00Z",
    "finished_at": "2026-11-01T10:03:00Z"
  }
]
```

`status` is one of `queued`, `running`, `succeeded`, `failed`, `cancelled`, `skipped`.
`agent` is `null` until a worker picks an agent for the review.

### `GET /api/v1/installations/{id}/stats`

Totals for the last 30 days, the review retention period.

```json
{
  "days": 30,
  "reviews": 8,
  "succeeded": 7,
  "failed": 1,
  "in_progress": 0,
  "pull_requests": 6,
  "repositories": 2,
  "median_duration_secs": 412.5,
  "findings": 7,
  "published": 7,
  "severity": [{ "name": "high", "count": 4 }],
  "categories": [{ "name": "bug", "count": 5 }],
  "daily": [{ "date": "2026-10-04", "reviews": 0, "failed": 0 }]
}
```

`median_duration_secs` is the time from queue to result for succeeded reviews.
It is `null` when no review succeeded. `categories` holds the five most common.
`daily` has one entry for each UTC day, oldest first.

### `GET /api/v1/installations/{id}/pulls`

Open pull requests in installation repositories that the user can access.
The API calls GitHub with the user token and caches the result for 60 seconds.

```json
{
  "truncated": false,
  "pulls": [
    {
      "repo_full_name": "acme/api",
      "number": 42,
      "title": "Add login",
      "draft": false,
      "author": "octocat",
      "author_id": 1,
      "comments": 2,
      "created_at": "2026-11-01T09:00:00Z",
      "updated_at": "2026-11-01T10:00:00Z",
      "review": {
        "id": "6f1c0b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
        "status": "succeeded",
        "head_sha": "abc123...",
        "finding_count": 3,
        "created_at": "2026-11-01T10:00:00Z"
      }
    }
  ]
}
```

The API uses GitHub search, last updated first, with at most 100 results.
`truncated` is true when GitHub has more. `review` is the newest CroCode review
of the pull request, or `null`. A GitHub failure returns `502`.

### `GET /api/v1/reviews/{id}`

One review with its findings.

```json
{
  "review": { "...": "same shape as a list item" },
  "summary": "Text of the review summary or skip reason",
  "findings": [
    {
      "id": "…",
      "path": "src/auth.rs",
      "start_line": null,
      "line": 120,
      "severity": "high",
      "category": "security",
      "title": "Token compared with ==",
      "body": "Explanation",
      "suggestion": "replacement code or null",
      "published": true
    }
  ],
  "files": [
    { "path": "src/auth.rs", "patch": "@@ -118,3 +118,4 @@ ..." }
  ]
}
```

`files` holds the GitHub PR patch of each file with findings, as reviewed.
Patches over 256 KiB are left out. Reviews from before this field have none.

`severity` is one of `critical`, `high`, `medium`, `low`, `info`.

### `GET /api/v1/reviews/{id}/pull`

Live pull request details from GitHub, read with the user token.

```json
{
  "state": "open",
  "draft": false,
  "author": "octocat",
  "author_id": 1,
  "base_ref": "main",
  "head_ref": "feat/login",
  "additions": 78,
  "deletions": 45,
  "changed_files": 3,
  "commits": 2,
  "created_at": "2026-11-01T09:00:00Z"
}
```

`state` is `open`, `closed`, or `merged`. The API returns `404` when GitHub does
not show the pull request to the user, and `502` for other GitHub failures.
