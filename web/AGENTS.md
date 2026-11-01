# Dashboard guide

- Use Bun 1.3.14. The host binary is `/home/ubuntu/.bun/bin/bun`.
- Install with `bun install --frozen-lockfile` after the first install.
- Run `bun run lint`, `bun run typecheck`, `bun test`, and `bun run build`.
- Run `bun run dev` for development on port 3000.
- Copy `.env.example` to `.env.local`. Set all six variables before opening a page.
- Keep API calls and tokens in server-only modules.
- Match `../docs/api.md`. Do not change the Rust API from this directory.
- Docker uses the Next.js standalone output. Set secrets at runtime.
