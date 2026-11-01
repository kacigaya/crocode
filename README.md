<p align="center">
  <img src="https://raw.githubusercontent.com/kacigaya/crocode/main/assets/crocode-logo.svg" alt="Crocode logo" width="200">
</p>

<h1 align="center">Crocode</h1>

<p align="center">
  <strong>Self-hostable AI code review for GitHub. Crocode runs Claude Code,
  Codex, or OpenCode in a read-only container, checks every finding against
  the diff, and posts inline review comments with severity and suggested
  fixes.</strong>
</p>

<p align="center">
  <a href="https://github.com/kacigaya/crocode/actions/workflows/ci.yml"><img alt="CI status" src="https://shieldcn.dev/github/ci/kacigaya/crocode.svg?workflow=ci.yml&amp;variant=secondary"></a>
  <a href="https://www.rust-lang.org/"><img alt="Rust 1.88 or newer" src="https://shieldcn.dev/badge/Rust-1.88%2B-dea584.svg?variant=secondary&amp;logo=rust"></a>
  <a href="https://nextjs.org/"><img alt="Next.js 16" src="https://shieldcn.dev/badge/Next.js-16-000000.svg?variant=secondary&amp;logo=nextdotjs"></a>
  <a href="docker-compose.yml"><img alt="Docker Compose for ARM64 and AMD64" src="https://shieldcn.dev/badge/Docker_Compose-ARM64_%7C_AMD64-2496ed.svg?variant=secondary&amp;logo=docker"></a>
  <a href="https://github.com/kacigaya/crocode/blob/main/LICENSE"><img alt="Apache 2.0 License" src="https://shieldcn.dev/github/license/kacigaya/crocode.svg?variant=secondary"></a>
</p>

> [!NOTE]
> Crocode is in development. No release is published yet.

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
5. Crocode drops findings outside the diff, removes duplicates, and redacts secrets.
6. Crocode posts one `COMMENT` review. It never approves or blocks a pull request.

A new push cancels the old review. A commit that already has a review is not reviewed again.

## Quickstart

You need a Linux host with Docker Compose. The worker starts sandbox containers
through the Docker socket, so give Crocode a dedicated host.

```bash
git clone https://github.com/kacigaya/crocode.git
cd crocode
cp .env.example .env && chmod 600 .env
```

1. [Register a GitHub App](docs/github-app.md). Put its ID, private key, and webhook secret in `.env`.
2. Set a database password and the API key for your agent in `.env`.
3. Set `DOCKER_GID` to the output of `stat -c '%g' /var/run/docker.sock`.
4. Create the work directory. The host path and the worker path must match.

   ```bash
   sudo install -d -m 0755 -o 10000 -g 10000 /var/lib/crocode/work
   ```

5. Build the sandbox image and start the backend.

   ```bash
   sudo docker build -t crocode-sandbox:latest docker/sandbox
   sudo docker compose up -d --build postgres api worker
   curl --fail http://localhost:8080/healthz
   ```

6. Put an HTTPS reverse proxy in front of port 8080. Point the app webhook at `/webhooks/github`.
7. Start the dashboard on port 3000.

   ```bash
   sudo docker compose --profile dashboard up -d --build
   ```

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
| Claude Code | `--bare --restricted`, tools `Read,Grep,Glob` only | `ANTHROPIC_API_KEY` |
| OpenCode | Every permission denied except read, glob, and grep | Provider key, for example `OPENROUTER_API_KEY` |
| Codex | `--sandbox read-only` | `CODEX_API_KEY` |

Codex needs bubblewrap namespaces. Docker's default profile blocks them, so the
example config enables Claude and OpenCode only. See
[image builds and checks](docker/README.md) before you enable Codex.

## Documentation

- [GitHub App setup](docs/github-app.md)
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

Crocode treats all pull request content as hostile. Agents get read-only tools,
credentials stay out of the sandbox, and published text is escaped so it
cannot ping users or load images. Sandbox network egress is open by default.
Read the [security model](docs/security.md) before you review untrusted code.

## License

Apache License 2.0. See [LICENSE](LICENSE).
