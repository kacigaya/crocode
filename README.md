<p align="center">
  <img src="https://raw.githubusercontent.com/kacigaya/crocode/main/assets/crocode-logo.svg" alt="CroCode logo" width="200">
</p>

<h1 align="center">CroCode</h1>

<p align="center">
  <strong>Self-hostable AI code review for GitHub.</strong>
  <br>
   <em>CroCode runs Claude Code,
  Codex, or OpenCode in a read-only container, checks every finding against
  the diff, and posts inline review comments with severity and suggested
  fixes.</em>
</p>

<p align="center">
  <a href="https://www.rust-lang.org/"><img alt="Rust 1.89 or newer" src="https://shieldcn.dev/badge/Rust-1.89%2B-dea584.svg?variant=secondary&amp;logo=rust"></a>
  <a href="https://nextjs.org/"><img alt="Next.js 16" src="https://shieldcn.dev/badge/Next.js-16-000000.svg?variant=secondary&amp;logo=nextdotjs"></a>
  <a href="docker-compose.yml"><img alt="Docker Compose for ARM64 and AMD64" src="https://shieldcn.dev/badge/Docker_Compose-ARM64_%7C_AMD64-2496ed.svg?variant=secondary&amp;logo=docker"></a>
  <a href="https://github.com/kacigaya/crocode/blob/main/LICENSE"><img alt="Apache 2.0 License" src="https://shieldcn.dev/github/license/kacigaya/crocode.svg?variant=secondary"></a>
</p>

> [!NOTE]
> CroCode is in development. See the [releases](https://github.com/kacigaya/crocode/releases) for available versions.

## How it works

```mermaid
flowchart LR
    GH[GitHub webhook] --> API[Rust API]
    API --> DB[(Postgres queue)]
    DB --> Worker[Rust worker]
    Worker --> Sandbox[Read-only agent container]
    Sandbox --> Validate[Validate and dedupe]
    Validate --> Review[GitHub review]
    Web[Next.js dashboard] --> API
```

1. The API verifies the webhook signature and queues the pull request.
2. A worker claims the job and mints a token for that one repository.
3. The worker reads `.crocode.yml` from the base commit, not from the pull request.
4. The agent reviews the diff in a container with a read-only checkout and no GitHub token.
5. CroCode drops findings outside the diff, removes duplicates, and redacts secrets.
6. CroCode posts one `COMMENT` review. It never approves or blocks a pull request.

A new push cancels the old review. A commit that already has a review is not reviewed again.

## Dashboard

Sign in with GitHub. Choose an installation to set its agent and model and to
follow its review history. Open a review to read each finding and its
suggested fix. The screenshots use demo data.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/login-dark.png">
    <img alt="CroCode sign-in page" src="assets/screenshots/login-light.png" width="49%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/installation-dark.png">
    <img alt="Installation settings and review history" src="assets/screenshots/installation-light.png" width="49%">
  </picture>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/review-dark.png">
    <img alt="Review with findings grouped by severity" src="assets/screenshots/review-light.png" width="100%">
  </picture>
</p>

## Quickstart

You need a Linux host with Docker Compose. The worker starts sandbox containers
through the Docker socket, so give CroCode a dedicated host.

```bash
git clone https://github.com/kacigaya/crocode.git
cd crocode
cp .env.example .env && chmod 600 .env
```

To let a coding agent do these steps, open the repository in Claude Code or Codex and ask it to set up CroCode.
The `crocode-setup` skill in `.agents/skills/` guides the agent. It asks before `sudo` commands and never shows secrets.

1. Set separate database setup and runtime passwords and your agent credentials in `.env`.
   Keep each password consistent with its connection URL.
   For Claude, use an API key or a subscription token from `claude setup-token`.
   Leave the GitHub App values empty. The dashboard creates the app.
2. Set `DOCKER_GID` to the output of `stat -c '%g' /var/run/docker.sock`.
3. Create the work directory. The host path and the worker path must match.

   ```bash
   sudo install -d -m 0755 -o 10000 -g 10000 /var/lib/crocode/work
   ```

4. Build the sandbox image and start everything.

   ```bash
   sudo docker build -t crocode-sandbox:latest docker/sandbox
   sudo docker compose --profile dashboard up -d --build
   ```

5. Put an HTTPS reverse proxy in front of the stack.
   Route `/webhooks/github` to the API on port 8080.
   Route everything else to the dashboard on port 3000.
6. Get the setup link from the dashboard logs.

   ```bash
   sudo docker compose logs web | grep setup
   ```

7. Open the link on your public address. Confirm the address and the app name, then click **Create the GitHub App**.
   GitHub asks you to confirm. CroCode saves the credentials, and the API and worker start on their own.
8. Follow the steps on the done page: install the app, upload the logo, and sign in.

To configure the app by hand instead, see [GitHub App setup](docs/github-app.md).
Environment variables always take precedence over the stored app.

## Repository config

Add `.crocode.yml` to the default branch. Every field is optional.

```yaml
agent: claude            # claude, codex, or opencode
min_severity: low        # info, low, medium, high, critical
max_comments: 20
review_drafts: false
ignore:
  - "docs/**"
instructions: |
  Focus on authentication and data loss.
```

See [all fields and defaults](docs/configuration.md).

## Agents

| Agent | Read-only mode | Credentials |
|---|---|---|
| Claude Code | `--bare --restricted`, tools `Read,Grep,Glob` only | `ANTHROPIC_API_KEY`, or a subscription token in `CLAUDE_CODE_OAUTH_TOKEN` |
| OpenCode | Every permission denied except read, glob, and grep | Provider key, for example `OPENROUTER_API_KEY` |
| Codex | `--sandbox read-only` | `CODEX_API_KEY` |

Codex needs bubblewrap namespaces. Docker's default profile blocks them, so the
example config enables Claude and OpenCode only. See
[image builds and checks](docker/README.md) before you enable Codex.

## Documentation

Read the [documentation site](https://kacigaya.github.io/crocode/docs/) on GitHub Pages.
It needs no sign-in. A local copy is also available at `/docs` on the dashboard.
The source guides are available here:

- [GitHub App setup](docs/github-app.md)
- [Dashboard](docs/dashboard.md)
- [Configuration](docs/configuration.md)
- [Security model](docs/security.md)
- [REST API](docs/api.md)
- [Docker images](docker/README.md)

## Development

```bash
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test --all
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres \
  cargo test --all -- --include-ignored
```

The dashboard lives in `web/` and uses Bun: `bun install`, `bun run lint`,
`bun run typecheck`, `bun test`, and `bun run build`.

## Security

CroCode treats all pull request content as hostile. Agents get read-only tools,
credentials stay out of the sandbox, and published text is escaped so it
cannot ping users or load images. Sandbox network egress is open by default.
Read the [security model](docs/security.md) before you review untrusted code.

## License

Apache License 2.0. See [LICENSE](LICENSE).
