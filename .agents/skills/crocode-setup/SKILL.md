---
name: crocode-setup
description: Set up a self-hosted CroCode instance on a Linux host with Docker Compose. Use when the user asks to install, set up, deploy, or configure CroCode, or to upgrade an existing CroCode database to the restricted runtime role. Do not use for CroCode code changes or repository `.crocode.yml` settings.
---

# Set up CroCode

Install CroCode from this repository with Docker Compose.
The dashboard then creates the GitHub App through GitHub's manifest flow.
Run commands from the repository root.

## Rules

- Never print, echo, or repeat secret values in chat or command output. Check secrets by name or count only.
  The one exception is the setup link in step 7. The user needs it.
- Never overwrite an existing `.env` or `web/.env`. Never delete a Docker volume.
- Ask the user before you run `sudo` commands, install packages, or change the reverse proxy or firewall.
- Never commit `.env`, `web/.env`, or `*.pem` files.
- Do not create the GitHub App yourself. The user must confirm it on GitHub while signed in.

## 1. Check the host

1. Confirm the host is Linux. Run `uname -sm`.
2. Run `sudo docker compose version`. Stop and tell the user if Docker Compose is missing.
3. Tell the user that the worker uses the Docker socket. CroCode needs a dedicated host.
4. Check the state:
   - `.env` is missing: do a new install. Go to step 2.
   - `.env` exists and has no `CROCODE_DB_PASSWORD=` line: the install is older than v0.4.0. Go to [Upgrade an existing database](#upgrade-an-existing-database).
   - `.env` exists and is complete: skip to step 5 and check the services.

## 2. Create `.env`

1. Copy the example and restrict it:

   ```sh
   cp .env.example .env && chmod 600 .env
   ```

2. Replace the two password placeholders with separate random values.
   The `sed` patterns also update both database URLs, so each password matches its URL.
   Hex values are URL-safe.

   ```sh
   admin=$(openssl rand -hex 32)
   runtime=$(openssl rand -hex 32)
   sed -i \
     -e "s/replace-with-url-safe-admin-password/$admin/g" \
     -e "s/replace-with-url-safe-runtime-password/$runtime/g" .env
   unset admin runtime
   grep -c 'replace-with' .env
   ```

   The last command must print `0`.

3. Set `DOCKER_GID` to the group of the Docker socket:

   ```sh
   gid=$(stat -c '%g' /var/run/docker.sock)
   sed -i "s/^DOCKER_GID=.*/DOCKER_GID=$gid/" .env
   ```

4. Leave `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, and `GITHUB_PRIVATE_KEY` empty. The dashboard fills them through setup.

## 3. Add agent credentials

Ask the user which agents to enable: `claude`, `opencode`, or `codex`.

1. Ask the user to add each credential to `.env` with their own editor, for example `nano .env`.
   If the user pastes a secret in chat, write it to `.env` without echoing it. Tell the user that the value is now in the chat history.
   - Claude: `ANTHROPIC_API_KEY`, or a subscription token from `claude setup-token` in `CLAUDE_CODE_OAUTH_TOKEN`.
   - OpenCode: a provider key, for example `OPENROUTER_API_KEY`.
   - Codex: `CODEX_API_KEY`. Codex needs bubblewrap namespaces. Run the checks in `docker/README.md` before you enable it.
2. Set `CROCODE_AGENTS` to only the agents that have credentials.
3. Set `CROCODE_DEFAULT_AGENT` to one of those agents.
4. Check the names without the values:

   ```sh
   grep -E '^[A-Z_]*(API_KEY|OAUTH_TOKEN)=.+' .env | cut -d= -f1
   ```

## 4. Start the stack

1. Create the work directory. The host path and the worker path must match.

   ```sh
   sudo install -d -m 0755 -o 10000 -g 10000 /var/lib/crocode/work
   ```

2. Validate the Compose files:

   ```sh
   sudo docker compose config --quiet
   sudo docker compose --profile dashboard config --quiet
   ```

3. Build the sandbox image and start all services:

   ```sh
   sudo docker build -t crocode-sandbox:latest docker/sandbox
   sudo docker compose --profile dashboard up -d --build
   ```

## 5. Check the services

1. Run `sudo docker compose --profile dashboard ps -a`.
   - `migrate` must exit with code 0.
   - `postgres` must be healthy.
   - `web` must be running.
   - `api` and `worker` wait for the GitHub App until setup is complete. This is normal.
2. If a service fails, read its logs with `sudo docker compose logs <service>`. Fix the cause before you continue.

## 6. Set up the public HTTPS address

GitHub must reach CroCode over HTTPS. Ask the user for the public domain, for example `crocode.example.com`.

Route traffic as follows:

- `/webhooks/github` goes to the API on `127.0.0.1:8080`.
- All other paths go to the dashboard on `127.0.0.1:3000`.
- The proxy must keep the public `Host` or set `X-Forwarded-Host`.

Example Caddyfile. Change the reverse proxy only after the user approves.

```caddy
crocode.example.com {
	handle /webhooks/github {
		reverse_proxy 127.0.0.1:8080
	}
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
```

Compose publishes ports 8080 and 3000 on all interfaces.
Docker bypasses `ufw` rules. Recommend a cloud firewall that allows only ports 80 and 443 from the internet.

## 7. Create the GitHub App

1. Get the setup link:

   ```sh
   sudo docker compose logs web | grep setup
   ```

2. The log line holds the path `/setup?token=...`. Give the user the full link: `https://<domain>/setup?token=...`.
   The token claims this instance. Tell the user to keep it private.
   If no line appears, the instance is already set up, or `GITHUB_CLIENT_ID` is set in `web/.env`.
3. The user opens the link, checks the address and the app name, and clicks **Create the GitHub App**.
   The default name is `CroCode Bot` with a random suffix, because GitHub App names are unique.
4. On the done page, the user installs the app, uploads the logo, and signs in.

## 8. Verify

1. Run `curl -fsS http://127.0.0.1:8080/healthz`. It must print `ok`.
2. Ask the user to open the app's **Advanced** tab on GitHub. The ping delivery must show `202`.
3. Ask the user to open a small pull request in an installed repository. Check that the worker claims the review:

   ```sh
   sudo docker compose logs worker --since 10m
   ```

Report each check result. Report each step that you skipped and the reason.

## Upgrade an existing database

Installs older than v0.4.0 use one database account for everything.
Follow [database setup and upgrades](../../../docs/configuration.md#database-setup-and-upgrades) exactly.
Ask the user to take a backup first. Never delete the `postgres-data` volume.

1. Keep `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` unchanged.
2. Add `CROCODE_DB_PASSWORD` with a new value from `openssl rand -hex 32`.
3. Add `MIGRATION_DATABASE_URL=postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB>` with the existing values.
4. Keep the old `DATABASE_URL` until the role setup completes.
5. Recreate Postgres and run the role setup once:

   ```sh
   sudo docker compose up -d --no-deps postgres
   sudo docker compose exec -T postgres sh /docker-entrypoint-initdb.d/init-runtime.sh
   ```

6. Set `DATABASE_URL=postgres://crocode_runtime:<CROCODE_DB_PASSWORD>@postgres:5432/<POSTGRES_DB>`.
7. Rebuild and start: `sudo docker compose --profile dashboard up -d --build`.
8. Continue with [Check the services](#5-check-the-services).

## References

- `README.md` quickstart
- `docs/github-app.md` for manual GitHub App setup
- `docs/configuration.md` for all settings
- `docs/security.md` for the security model
- `docker/README.md` for sandbox and Codex checks
