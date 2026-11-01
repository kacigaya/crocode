# Configuration

Copy [.env.example](../.env.example) to `.env` for Compose.
Replace all required placeholders before you start the services.
The server reads environment variables at startup.
It does not load `.env` when you run the binary directly.
Compose loads that file through `env_file`.

## Server environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | Required | Postgres connection URL. The server applies migrations at startup. |
| `CROCODE_BIND` | `0.0.0.0:8080` | API listen address. |
| `GITHUB_APP_ID` | Required | Numeric GitHub App ID. |
| `GITHUB_PRIVATE_KEY_PATH` | Unset | Path to a PEM file. Takes priority over the inline key. Unset it when you use the inline key. |
| `GITHUB_PRIVATE_KEY` | Required without a key path | PEM private key. Literal `\n` becomes a line break. |
| `GITHUB_WEBHOOK_SECRET` | Required | Webhook HMAC secret, at least 16 bytes. Use random ASCII text. |
| `GITHUB_API_URL` | `https://api.github.com` | GitHub REST API base URL. Use the API URL for your GitHub Enterprise host if needed. |
| `GITHUB_WEB_URL` | `https://github.com` | Git host used to fetch repository PR heads. Trailing slashes are removed. |
| `CROCODE_AGENTS` | `claude,codex,opencode` | Comma-separated enabled agents. |
| `CROCODE_DEFAULT_AGENT` | First enabled agent | Must appear in `CROCODE_AGENTS`. |
| `CROCODE_SANDBOX` | `docker` | `docker` or `none`. Use `none` only for trusted local development. |
| `CROCODE_SANDBOX_IMAGE` | `crocode-sandbox:latest` | Image on the worker's Docker daemon. Build it before you start reviews. |
| `CROCODE_SANDBOX_NETWORK` | `bridge` | Docker network for agent containers. The model client needs provider access. |
| `CROCODE_SANDBOX_RUNTIME` | Unset | Optional installed Docker runtime, such as `runsc`. |
| `CROCODE_WORK_DIR` | `/var/lib/crocode/work` | Job checkout, input, and output directory. Use an absolute path with Docker. |
| `CROCODE_WORKER_CONCURRENCY` | `4` | Worker slots per process. Minimum 1. |
| `CROCODE_MAX_PER_INSTALLATION` | `2` | Soft concurrent review cap per installation. Minimum 1. Concurrent claims can exceed it. |
| `CROCODE_AGENT_TIMEOUT_SECS` | `900` | Timeout for one agent process, in seconds. Each Git command has a separate 300-second timeout. |
| `CROCODE_MAX_REPO_SIZE_MB` | `1024` | Pre-check against GitHub's reported repository size. This is not a disk quota. |
| `CROCODE_AGENT_ENV` | Empty | Extra environment variable names to pass to agents, separated by commas. Values stay off the Docker command line. |
| `CROCODE_LOG_FORMAT` | Plain text | `json` selects JSON logs. Other values select plain text. |
| `RUST_LOG` | `info` | Tracing filter. |
| `HOSTNAME` | `worker` if absent | Prefix for the random worker lease ID. Docker normally sets it. |

Empty optional values use defaults unless stated otherwise.
`GITHUB_PRIVATE_KEY_PATH` is checked for presence, so remove it instead of setting it to an empty string.
The API and worker both need the database and GitHub App settings.

The `.env.example` enables `claude,opencode` because the local Docker host blocks Codex's bubblewrap namespaces.
The code default still enables all three agents.
See [the container checks](../docker/README.md#local-verification) before you enable Codex.

## Provider credentials

The worker passes only the selected agent's listed variables and `CROCODE_AGENT_ENV` to the agent.
Set only the provider values you use.
Alternative providers can need more credentials in `CROCODE_AGENT_ENV`.

| Agent | Automatic environment variables |
| --- | --- |
| Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` |
| Codex | `CODEX_API_KEY`, `OPENAI_BASE_URL` |
| OpenCode | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_API_KEY` |

Never add GitHub tokens, app keys, database URLs, OAuth secrets, or session secrets to `CROCODE_AGENT_ENV`.
The agent must be able to use its model key. A read-only filesystem does not hide environment variables from it.
Do not mount your personal CLI home directory into a sandbox.

Crocode sets `HOME=/home/agent` inside Docker.
It supplies the fixed OpenCode permission config through `OPENCODE_CONFIG_CONTENT`.
It disables project config, Claude config, and external skills for OpenCode.
It uses `--pure` to block external plugins.
The sandbox image disables Claude auto-updates.
Rebuild the image to update pinned CLIs.

## Compose environment

| Variable | Example or default | Meaning |
| --- | --- | --- |
| `POSTGRES_USER` | Example: `crocode` | Initial database user. |
| `POSTGRES_PASSWORD` | Required replacement | Initial database password. Keep it consistent with `DATABASE_URL`. |
| `POSTGRES_DB` | Example: `crocode` | Initial database name. |
| `DOCKER_GID` | `0` | Docker socket's host group ID. Read it with `stat -c '%g' /var/run/docker.sock`. |
| `CROCODE_WORK_DIR` | `/var/lib/crocode/work` | Same absolute bind path on host and worker. Create it with owner `10000:10000`. |
| `PUBLIC_URL` | Example: `https://crocode.example.com` | Public site address for GitHub App registration. The Rust server does not read it. |

The `postgres-data` named volume holds database files.
Postgres initialization variables do not change the password or user in an existing data volume.
The `web` service uses the `dashboard` profile until its Dockerfile is merged.
The dashboard's OAuth and session variable names must follow that branch's documentation.

## Repository config

Crocode reads `.crocode.yml` from the PR base commit, not the head checkout.
An absent or blank file uses the defaults.
Unknown fields, bad YAML, and bad ignore patterns fail the review without a retry.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Run reviews for this repository. A disabled repository records a skipped review. |
| `agent` | `null` | `claude`, `codex`, or `opencode`. Must be enabled on the server. |
| `model` | `null` | Agent model name. `null` uses the selection rules below. |
| `review_drafts` | `false` | Review draft PRs. |
| `min_severity` | `low` | Minimum finding severity: `info`, `low`, `medium`, `high`, or `critical`. |
| `max_comments` | `20` | Maximum inline findings. Values above 50 become 50. Other findings stay in the summary. |
| `max_files` | `100` | Maximum changed files before ignore filtering. Includes removed files and files without patches. |
| `max_changed_lines` | `3000` | Maximum added plus deleted lines across reviewed files after filtering. |
| `ignore` | `[]` | Extra glob patterns. Adds to the default ignores. |
| `instructions` | `null` | Maintainer review guidance. Crocode keeps the first 4,000 characters. It cannot change the output format or safety rules. |

Repository agent selection takes priority over installation settings, then the server default.
An explicit repository agent also resets the installation model.
Without a repository agent, a repository model overrides the installation model.
An absent model uses the selected agent's own default.

Model names must be 1 to 100 ASCII characters.
They can contain letters, digits, and `._:/@#-[]`.
They cannot start with `-`.

These ignore patterns always apply:

```text
**/*.lock
**/package-lock.json
**/pnpm-lock.yaml
**/*.min.js
**/*.map
**/*.snap
**/vendor/**
**/node_modules/**
```

An ignore pattern removes a file from review findings. It does not remove that file from the checkout sent to the model.
Removed files and files without GitHub patches are not reviewed.
GitHub's file endpoint returns at most 3,000 files.
Keep `max_files` below that service limit.

## Fixed worker behavior

The queue allows three attempts.
Retry delay starts at 30 seconds, doubles, and stops growing at 10 minutes.
The worker polls every 2 seconds.
It sends heartbeats every 20 seconds.
The reaper runs every 60 seconds and requeues running jobs with heartbeats older than 120 seconds.
A stale job at its attempt limit becomes failed.
Shutdown releases a running job without counting its attempt when cancellation reaches the worker.

Delivery IDs remain for 7 days.
The unique repository, PR number, and head SHA prevent another queue row for the same commit.
The dashboard API caches user access for 60 seconds.
These values are code constants, not environment settings.
