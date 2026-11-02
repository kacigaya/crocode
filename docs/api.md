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

Agents that this server can run.

```json
{ "agents": ["claude", "codex", "opencode"], "default": "claude" }
```

### `GET /api/v1/installations`

Installations that the user can access and that exist in the database.

```json
[
  {
    "id": 123,
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
  ]
}
```

`severity` is one of `critical`, `high`, `medium`, `low`, `info`.
