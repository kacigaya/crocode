# Configuration

Copy [.env.example](../.env.example) to `.env` for Compose.
Replace all required placeholders before you start the services.
The server reads environment variables at startup.
It does not load `.env` when you run the binary directly.
Compose reads that file for `${...}` interpolation.
Each service gets only the variables it reads:

1. `postgres` gets the `POSTGRES_*` variables and `CROCODE_DB_PASSWORD` for account setup.
2. `api` gets the database, GitHub App, agent list, and log variables. It gets no agent credentials.
3. `worker` loads `.env` through `env_file`, but Compose clears the database setup credentials. It passes only named variables into sandbox containers.
4. `web` loads `web/.env` through `env_file`. Compose sets `CROCODE_API_URL=http://api:8080`.
5. `migrate` receives only `MIGRATION_DATABASE_URL`. It needs no GitHub credentials.

Keep the dashboard secrets in `web/.env`, not in `.env`.
Copy [web/.env.example](../web/.env.example) to start.
If you add a variable to the `api` service, add it to `docker-compose.yml` too.

## Server environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | Required | Postgres connection URL for a restricted runtime role. Startup rejects superuser, database-creation, role-creation, and RLS-bypass privileges. |
| `MIGRATION_DATABASE_URL` | Required for `crocode migrate` only | Separate database setup URL. Never pass it to the API, worker, or sandbox. |
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
| `CROCODE_FALLBACK_AGENT` | Unset | Enabled agent name, or `auto` for Claude/Codex fallback in both directions. Tried once per attempt on a usage or rate limit. |
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
| `CROCODE_SAST` | `on` | `on` runs OpenGrep before the agent. `off` skips it. See [Static analysis](#static-analysis). |
| `CROCODE_SAST_TIMEOUT_SECS` | `300` | Timeout for one static analysis run, in seconds. |
| `CROCODE_SAST_RULES` | `/opt/opengrep-rules` | Rules root as the scan process sees it. Change it only in host mode. |
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

Set `CROCODE_FALLBACK_AGENT=auto` to switch from Claude to Codex, or from
Codex to Claude, when the selected agent reports a usage or rate limit
instead of a valid review. Both agents must appear in `CROCODE_AGENTS`.
Automatic mode does not choose a fallback for OpenCode.

An explicit name, such as `CROCODE_FALLBACK_AGENT=codex`, keeps fixed-agent
fallback. Empty or unset disables fallback.

The fallback uses its default model. It does not inherit the first agent's
model name. Each review attempt can switch agents once. If both agents hit
their limits, the attempt ends and the normal retry policy applies.
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

## Use a subscription

Claude Code and Codex can run on the subscription you already have.
You do not need an API key or a per-token bill.
Reviews count against your plan usage limits.

### Claude with a Claude subscription

1. Run `claude setup-token` and copy the token.
2. Set `CLAUDE_CODE_OAUTH_TOKEN` to the token. Leave `ANTHROPIC_API_KEY` empty.

A nonempty API key takes precedence over the token.
Subscription runs cannot use the OSV tools. See [OSV vulnerability tools](#osv-vulnerability-tools).

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

## OSV vulnerability tools

Codex, OpenCode, and Claude with an API key receive two OSV tools through a worker-supplied MCP server:

- `query`: look up an exact public package version and follow result pages.
- `get_vulnerability`: fetch an advisory by OSV ID, including CVE aliases and affected ranges.

Claude subscription runs keep `--safe-mode`. In the pinned Claude CLI, this mode
ignores even explicitly supplied MCP servers. OSV tools are unavailable for those
runs. Use API-key authentication for Claude OSV lookups, or use Codex or OpenCode.
Keep safe mode enabled until a CLI version supports trusted MCP tools in that mode.

The [OSV API](https://google.github.io/osv.dev/api/) needs no API key.
Do not set `OSV_API_KEY` or add OSV credentials to `CROCODE_AGENT_ENV`.
The worker writes the tool server into the read-only job input directory.
The sandbox image already includes Node.js. Host mode needs Node.js 24 or later on `PATH`.
Rebuild the worker image to install these tools. No sandbox image change is needed.

The tools contact only `https://api.osv.dev` and reject redirects.
Each call has a 20-second timeout and a 2 MiB response limit.
Failed or incomplete lookups must appear as a gap in the review summary.
Agents choose when to query OSV. This is not a full dependency scan.
The prompt permits only public package names and exact versions in queries.
OSV receives those values. Do not use these tools for private package names.

Sandbox networking must permit HTTPS to `api.osv.dev`.
`CROCODE_SANDBOX_NETWORK=none` prevents OSV lookups.
The tools do not give agents shell, write, or arbitrary URL access.

## Static analysis

Before the agent runs, the worker scans the changed files with [OpenGrep](https://github.com/opengrep/opengrep).
The sandbox image bundles OpenGrep 1.33.1 and a pinned copy of
[opengrep-rules](https://github.com/opengrep/opengrep-rules). See [the license note](../docker/README.md#opengrep-rules-license).

1. The worker selects the rule directories for the languages of the changed files.
   It always adds the generic rules, such as secret detection.
2. The scan runs in its own sandbox container with no network and no credentials.
3. The worker keeps results that touch an added line. It keeps at most 50, most severe first.
4. The agent receives the results as hints. It checks each one and reports only real problems.
5. The dashboard lists the results in the **Static analysis** tab of the review.

The scan ignores `.semgrepignore` files and `nosemgrep` comments. A pull request cannot hide code from it.
A failed or timed-out scan does not fail the review. The agent then reviews without hints.
A scan that finishes with errors, such as a file that timed out, is `partial`. The agent still gets its results.

A scan of one or two languages takes about 30 seconds with `runc`, and about 90 seconds with `runsc`.
Most of the time goes to loading rules. Set `CROCODE_SAST=off` to skip the scan on every repository,
or `sast: false` in `.crocode.yml` to skip it for one repository.

In host mode (`CROCODE_SANDBOX=none`), install `opengrep` on `PATH` and set `CROCODE_SAST_RULES`
to a local rules directory. Host mode cannot block the scan's network access.

## Weekly security digest

The weekly security digest is off by default. An installation admin turns it on in
**Settings** with an HTTPS chat webhook URL. The digest posts a Slack-compatible
JSON body, `{"text": "..."}`. Slack and Mattermost incoming webhooks accept it.
For Discord, add `/slack` to the end of the webhook URL.

Every 7 days, the worker reads the Dependabot alerts of all installation repositories.
It uses a token that can only read Dependabot alerts and repository metadata.
The digest covers the time since the start of the last successful read, at most 30 days.
The next window starts where the last read started, so no alert falls between two digests:

- **New alerts**: alerts created in that time that are open or fixed.
- **Fixed alerts**: alerts fixed in that time.
- **Overdue open alerts**: open alerts older than the deadline for their severity.

| Severity | Deadline |
| --- | --- |
| `critical` | 15 days |
| `high` | 30 days |
| `medium` | 90 days |
| `low` | 180 days |

Each section lists at most 5 alerts. The counts include every alert.
The digest names repositories, packages, and CVE or GHSA IDs. It contains no advisory text.
It reads at most 500 repositories. A repository that answers 401, 403, or 404 counts as
"could not be read", and the digest still goes out. These answers mean no access or disabled alerts.
A timeout, rate limit, or server error stops the send. The worker tries again in an hour with the
same window, so no alert change is lost.
Dismissed alerts are not counted. This is GitHub's alert inventory, not a full security scan.

The worker checks for due digests every 10 minutes. After a failed send it tries again every hour.
The database stores the webhook URL encrypted with a key derived from the GitHub App private key.
After you rotate that private key, the worker cannot read stored URLs. The settings page then shows
an error. Enter the webhook URL again to fix it.
The settings page shows the last send and the last error.
The GitHub App needs the read-only **Dependabot alerts** permission. See
[Enable the vulnerability panel](github-app.md#enable-the-vulnerability-panel-on-an-existing-app).

The worker needs outbound HTTPS to the webhook host. It connects only to public addresses.
See [Network and data exposure](security.md#network-and-data-exposure).

## Compose environment

| Variable | Example or default | Meaning |
| --- | --- | --- |
| `POSTGRES_USER` | Example: `crocode` | Initial database administrator. |
| `POSTGRES_PASSWORD` | Required replacement | Initial administrator password. Keep it consistent with `MIGRATION_DATABASE_URL`. |
| `CROCODE_DB_PASSWORD` | Required replacement | Separate password for `crocode_runtime`. Keep it consistent with `DATABASE_URL`. |
| `POSTGRES_DB` | Example: `crocode` | Initial database name. |
| `DOCKER_GID` | `0` | Docker socket's host group ID. Read it with `stat -c '%g' /var/run/docker.sock`. |
| `CROCODE_WORK_DIR` | `/var/lib/crocode/work` | Same absolute bind path on host and worker. Create it with owner `10000:10000`. |

The `postgres-data` named volume holds database files.
Postgres initialization variables do not change the password or user in an existing data volume.
The `web` service uses the `dashboard` profile.
Set its variables in `web/.env`. See [dashboard setup](dashboard.md).

The worker removes completed reviews after 30 days and deleted installations’ reviews on its next cleanup pass.
Cleanup runs once per minute. It also removes findings and stored patches.
Backups and GitHub reviews are outside this policy.

## Database setup and upgrades

Compose runs `crocode migrate` before the API and worker start.
The migration service receives the setup URL. Runtime services receive only the runtime URL.
New Postgres volumes create `crocode_runtime` with data access and no schema ownership.
The migration ledger is not accessible to that role.

For a direct binary run:

1. Set `MIGRATION_DATABASE_URL` in the migration process.
2. Run `crocode migrate`.
3. Set `DATABASE_URL` to the restricted account in the API and worker processes.
4. Start the API and worker without the setup URL in their environment.

Existing volumes require a one-time account setup. Do not delete the volume.
Take a backup before you change the deployment.

1. Keep the existing `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` values.
2. Add `CROCODE_DB_PASSWORD` and `MIGRATION_DATABASE_URL` to `.env`.
3. Keep the old `DATABASE_URL` until the next step completes.
4. Recreate only the Postgres container to load the new environment and script mount. This preserves the volume. Run the role setup script as the existing database owner:

   ```sh
   sudo docker compose up -d --no-deps postgres
   sudo docker compose exec -T postgres sh /docker-entrypoint-initdb.d/init-runtime.sh
   ```

5. Set `DATABASE_URL` to the `crocode_runtime` URL.
6. Rebuild and start the services with `sudo docker compose up -d --build migrate api worker`.

Run the role setup script once. It fails if the runtime role already exists.
For externally managed Postgres, create a separate login role and grant schema usage and data access on the application tables.
Do not grant access to `_sqlx_migrations` or ownership of application tables.
The bootstrap script and migration command must use the same database owner so default grants apply to new tables.

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
| `sast` | `true` | Run static analysis before the agent. It runs only when `CROCODE_SAST` is also `on`. |
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
