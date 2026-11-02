# Dashboard guide

- Use Bun 1.3.14. The host binary is `/home/ubuntu/.bun/bin/bun`.
- Install with `bun install --frozen-lockfile` after the first install.
- Run `bun run lint`, `bun run typecheck`, `bun test`, and `bun run build`.
- Run `bun run dev` for development on port 3000.
- Copy `.env.example` to `.env.local`. Set all six variables before opening dashboard pages. `/docs` needs no credentials.
- Keep API calls and tokens in server-only modules.
- Match `../docs/api.md`. Do not change the Rust API from this directory.
- Docker uses the Next.js standalone output. Set secrets at runtime.
- Docs routes live at `/docs` and `/docs/[[...slug]]`. Navigation and metadata live in `lib/docs-nav.ts`. Article sections live in `lib/docs-content.tsx`.
- Docs use React components with no Markdown dependency. Keep guides aligned with `../README.md`, `../docs/`, and `../docker/README.md`.
- Run `bun run scripts/smoke.ts` after the build to check the standalone dashboard and public docs routes.
- GitHub Pages uses the static app in `site/`. Run `bun run build:docs` and `bun run scripts/check-docs-export.ts`. Output: `site/out/`. Default base path: `/crocode`.
- `.github/workflows/pages.yml` at the repository root checks pull requests and deploys pushes to `main`. Pages uses the GitHub Actions source. `lib/docs-site.ts` holds the public docs URL.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
