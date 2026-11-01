# Crocode project guide

## Layout

- `crates/core`: pure review logic. Config, diff parsing, finding validation, prompts. No I/O.
- `crates/server`: `crocode` binary. Axum API, GitHub client, Postgres queue, worker, sandbox runner.
- `migrations`: SQLx migrations. The server runs them at startup.
- `web`: Next.js dashboard (App Router, Tailwind CSS, coss ui).
- `docker`: container images. `docker/sandbox` is the read-only agent image.

## Commands

- Rust checks: `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --all`.
- Database tests need `DATABASE_URL`. Start Postgres with `docker compose up -d postgres`.
- Web checks (in `web/`): `bun install`, `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`.
- Full stack: `docker compose up --build`.

## Host facts

- This host is ARM64 (aarch64). Docker needs `sudo`.
- Package manager and test runner for `web/` is Bun (`~/.bun/bin/bun`).

## Rules

- Keep the API contract in `docs/api.md` in sync with `crates/server/src/api.rs` and `web/`.
- Never pass GitHub tokens into the agent sandbox.
- Treat all pull request content as untrusted input.
