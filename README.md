# Crocode

Crocode is an open-source, self-hostable GitHub AI code review bot.
It runs Claude Code, Codex, or OpenCode in a read-only container.
It checks the findings and posts one GitHub `COMMENT` review with inline comments.
It does not approve or block a pull request.
If there are no new findings, it saves the result without posting a review.

Status: in development. License: [Apache 2.0](LICENSE).

```mermaid
flowchart LR
    GH[GitHub webhook] --> API[Rust API: verify signature]
    API --> DB[(Postgres queue)]
    DB --> Worker[Rust worker]
    Worker --> Base[Config from base commit]
    Worker --> Sandbox[Read-only agent container]
    Sandbox --> Validate[Validate and dedupe findings]
    Validate --> Review[GitHub COMMENT review]
    Validate --> DB
    Web[Next.js dashboard] --> API
```

`crates/core` holds the pure review logic.
`crates/server` holds the API, queue, GitHub client, and worker.
The worker keeps GitHub credentials outside the agent container.
See the [security model](docs/security.md) before you run reviews on untrusted code.

## Quick start

Use a Linux Docker host with Docker Compose.
The worker needs the Docker socket. Socket access gives it control of the host daemon.
Use a dedicated host for reviews.
The images support ARM64 and AMD64.
See [image builds and local checks](docker/README.md) for the Codex namespace limitation.

1. Clone the repository.

   ```sh
   git clone https://github.com/kacigaya/crocode.git
   cd crocode
   ```

2. Copy the environment example.

   ```sh
   cp .env.example .env
   chmod 600 .env
   ```

3. [Register a GitHub App](docs/github-app.md).
   Set the app ID, private key, and webhook secret in `.env`.
   Set a new database password in both `POSTGRES_PASSWORD` and `DATABASE_URL`.
   Set the API key for your chosen agent.
   The placeholders will not authenticate.

4. Set `DOCKER_GID` in `.env` to this value.

   ```sh
   stat -c '%g' /var/run/docker.sock
   ```

5. Create the work directory with the worker's user ID.
   If you change `CROCODE_WORK_DIR`, use that same absolute path here.
   The host path and the worker path must match because sandbox containers are siblings.

   ```sh
   sudo install -d -m 0755 -o 10000 -g 10000 /var/lib/crocode/work
   ```

6. Build the sandbox image on the worker's Docker daemon.

   ```sh
   sudo docker build -t crocode-sandbox:latest docker/sandbox
   ```

7. Check Compose and start the backend.
   The server applies database migrations at startup.

   ```sh
   sudo docker compose config --quiet
   sudo docker compose up -d --build postgres api worker
   curl --fail http://localhost:8080/healthz
   ```

8. Put an HTTPS reverse proxy in front of the API.
   Send `/webhooks/github` to API port 8080.
   Keep webhook SSL verification enabled in GitHub.
   Install the app on selected repositories.
   Open a pull request and check the worker logs.

   ```sh
   sudo docker compose logs -f api worker
   ```

The dashboard Dockerfile arrives with the dashboard branch.
The `web` service stays in the `dashboard` profile until that merge.
After the merge, configure its OAuth and session variables, then start it:

```sh
sudo docker compose --profile dashboard up -d --build
```

The dashboard uses port 3000.
Route its OAuth callback `${PUBLIC_URL}/api/auth/callback` to the web service.
Keep the Rust REST API internal to the dashboard where possible.
Change the published ports if another service uses 8080 or 3000.

The example enables Claude and OpenCode.
Enable Codex only after its read-only sandbox probe passes on your Docker host.
No personal CLI login directory needs to be mounted into any container.

## Repository config

Add `.crocode.yml` to the base branch before you open a pull request.
Crocode reads the file from the PR base commit.
A change to this file inside the PR does not change that PR's review settings.

```yaml
enabled: true
agent: claude
model: null
review_drafts: false
min_severity: low
max_comments: 20
max_files: 100
max_changed_lines: 3000
ignore:
  - "docs/**"
instructions: |
  Focus on authentication and data loss.
  Report a clear failure case for each finding.
```

See [all configuration fields and defaults](docs/configuration.md), [GitHub App setup](docs/github-app.md), and the [REST API contract](docs/api.md).

## Development

1. Run the Rust checks.

   ```sh
   cargo fmt --all --check
   cargo clippy --all-targets -- -D warnings
   cargo test --all
   ```

2. Run the ignored DB tests against a separate Postgres 17 instance.
   The user must be able to create test databases.
   SQLx applies the migrations to each test database.

   ```sh
   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres \
     cargo test --all -- --include-ignored
   ```

3. Run the web checks after its branch is merged.

   ```sh
   cd web
   bun install --frozen-lockfile
   bun run lint
   bun run typecheck
   bun test
   bun run build
   ```

CI runs the Rust checks with Postgres 17.
It checks the dashboard when its package manifest exists.
It builds both Dockerfiles on native ARM64 and AMD64 runners without publishing images.
