# Configuration

Copy [.env.example](../.env.example) to `.env` for Compose.
Replace all required placeholders before you start the services.
The server reads environment variables at startup.
It does not load `.env` when you run the binary directly.
Compose reads that file for `${...}` interpolation.
Each service gets only the variables it reads:

1. `postgres` gets the three `POSTGRES_*` variables.
2. `api` gets the database, GitHub App, agent list, and log variables. It gets no agent credentials.
3. `worker` loads the whole `.env` through `env_file`. It passes only named variables into sandbox containers.
4. `web` loads `web/.env` through `env_file`. Compose sets `CROCODE_API_URL=http://api:8080`.

Keep the dashboard secrets in `web/.env`, not in `.env`.
Copy [web/.env.example](../web/.env.example) to start.
If you add a variable to the `api` service, add it to `docker-compose.yml` too.

## Server environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | Required | Postgres connection URL. The server applies migrations at startup. |
| `CROCODE_BIND` | `0.0.0.0:8080` | API listen address. |
| `CROCODE_CONFIG_DIR` | Unset | Directory with `github-app.json` from dashboard setup. Compose sets `/config`. Used only when `GITHUB_APP_ID` is empty. Until the file exists, the API and worker wait. |
| `GITHUB_APP_ID` | Required without setup | Numeric GitHub App ID. When set, the GitHub variables below take precedence over `CROCODE_CONFIG_DIR`. |
| `GITHUB_PRIVATE_KEY_PATH` | Unset | Path to a PEM file. Takes priority over the inline key. Unset it when you use the inline key. |
| `GITHUB_PRIVATE_KEY` | Required with `GITHUB_APP_ID` and no key path | PEM private key. Literal `\n` becomes a line break. |
| `GITHUB_WEBHOOK_SECRET` | Required with `GITHUB_APP_ID` | Webhook HMAC secret, at least 16 bytes. Use random ASCII text. |
| `GITHUB_API_URL` | `https://api.github.com` | GitHub REST API base URL. Use the API URL for your GitHub Enterprise host if needed. |
| `GITHUB_WEB_URL` | `https://github.com` | Git host used to fetch repository PR heads. Trailing slashes are removed. |
| `CROCODE_AGENTS` | `claude,codex,opencode` | Comma-separated enabled agents. |
| `CROCODE_DEFAULT_AGENT` | First enabled agent | Must appear in `CROCODE_AGENTS`. |
| `CROCODE_FALLBACK_AGENT` | Unset | Optional enabled agent to try once when the selected agent reports a usage or rate limit. |
| `CROCODE_CODEX_AUTH_DIR` | Unset | Dedicated absolute host directory with a Codex ChatGPT login cache. Docker sandbox only. Mounted read-write only for Codex. |
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

## Agent fallback

Set `CROCODE_FALLBACK_AGENT=codex` to try Codex when the selected agent reports
a usage or rate limit instead of a valid review. Also enable `codex` in
`CROCODE_AGENTS`. The fallback uses its default model. It does not inherit the
first agent's model name. Each review attempt can use the fallback once.
Other errors keep the normal retry behavior. Cancellation stops the review.
The result records the agent and model that produced the review.

Fallback does not fix missing credentials or an incompatible sandbox runtime.
Keep the fallback unset until its authentication and sandbox probes pass.

## Provider credentials

The worker passes only the selected agent's listed variables and `CROCODE_AGENT_ENV` to the agent.
Set only the provider values you use.
Alternative providers can need more credentials in `CROCODE_AGENT_ENV`.

| Agent | Automatic environment variables |
| --- | --- |
| Claude | `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` |
| Codex | `CODEX_API_KEY`, `OPENAI_BASE_URL` |
| OpenCode | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_API_KEY` |

To use a Claude subscription instead of an API key:

1. Run `claude setup-token` and copy the token.
2. Set `CLAUDE_CODE_OAUTH_TOKEN` to the token. Leave `ANTHROPIC_API_KEY` empty.

An API key takes precedence. Reviews then count against the subscription usage limits.

### Codex with a ChatGPT subscription

Use a separate Codex login for each worker. Do not mount your normal Codex home:
it can contain configuration, plugins, and unrelated session data.

1. Create a dedicated directory on the Docker host. Give uid/gid `10001:10001` access. Set its mode to `0700`.
2. Mount that directory at `/home/agent/.codex` in a temporary sandbox-image container. Run `codex login --device-auth` as uid/gid `10001:10001` and complete the login.
3. Set `CROCODE_CODEX_AUTH_DIR` to the absolute host directory. Leave `CODEX_API_KEY` empty to use the subscription.
4. Reserve that directory for CroCode. Workers that share it must use the same database and identical host path. Do not use that login from other tools.
5. Verify the Codex read-only sandbox before enabling fallback. See [container checks](../docker/README.md#local-verification).

Codex can update its login cache when tokens refresh. Only Codex containers
receive this directory. A database advisory lock serializes Codex runs that
use the same directory. The worker reads the old and refreshed tokens through
a separate container and redacts them from stored agent output. The API does
not mount the directory. No GitHub credentials enter the agent sandbox.
The login remains subject to your ChatGPT plan limits.

Never add GitHub tokens, app keys, database URLs, OAuth secrets, or session secrets to `CROCODE_AGENT_ENV`.
The agent must be able to use its model key. A read-only filesystem does not hide environment variables from it.
Do not mount your personal CLI home directory into a sandbox.

CroCode sets `HOME=/home/agent` inside Docker.
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

The `postgres-data` named volume holds database files.
Postgres initialization variables do not change the password or user in an existing data volume.
The `web` service uses the `dashboard` profile.
Set its variables in `web/.env`. See [dashboard setup](dashboard.md).

## Repository config

CroCode reads `.crocode.yml` from the PR base commit, not the head checkout.
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
| `instructions` | `null` | Maintainer review guidance. CroCode keeps the first 4,000 characters. It cannot change the output format or safety rules. |

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
