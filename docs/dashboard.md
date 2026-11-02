# CroCode dashboard

The dashboard uses Next.js 16.4.3, React 19.3.1, Tailwind CSS 4, and Coss UI.
Use Bun 1.3.14. All dashboard files are in `web/`.

## Documentation

Read the [public docs](https://kacigaya.github.io/crocode/docs/) on GitHub Pages.
The dashboard also serves a local copy at `/docs`. The guides cover setup, configuration,
agents, dashboard use, security, the REST API, and development. They need no
sign-in or GitHub credentials. The landing page and dashboard link to the public site.

Navigation and page metadata live in `web/lib/docs-nav.ts`. Article sections
live in `web/lib/docs-content.tsx`. Keep them aligned with the Markdown files
in `docs/`, `README.md`, and `docker/README.md`. The articles use React components
to avoid a Markdown runtime dependency.

The static app in `web/site/` reuses these articles and components. It excludes
dashboard, setup, and authentication routes. Run `bun run build:docs` from `web/`
to export it to `web/site/out/`. Run `bun run scripts/check-docs-export.ts` to
check local links, assets, canonical URLs, and the static route boundary.

`.github/workflows/pages.yml` checks the export on pull requests and publishes
it after a push to `main`. GitHub Pages uses the GitHub Actions build source.
The site uses the `/crocode` base path. `NEXT_PUBLIC_BASE_PATH` can override the
path for a local test. `web/lib/docs-site.ts` holds the public site URL.

## Local setup

1. Run `bun install` in `web/`.
2. Copy `.env.example` to `.env.local`.
3. Set all six variables. `BETTER_AUTH_SECRET` must contain at least 32 random characters. Keep it private and stable.
4. Set the GitHub App user OAuth callback to `${BETTER_AUTH_URL}/api/auth/callback/github`.
5. Start the Rust API. Set `CROCODE_API_URL` to its server-side address.
6. Run `bun run dev`. Open the address set in `BETTER_AUTH_URL`.

`BETTER_AUTH_URL` must be an HTTP or HTTPS origin with no path. Use HTTPS in production.
Environment values are checked on first use. Builds do not need secrets.
The dashboard does not use `NEXT_PUBLIC_` variables.

## First-run setup

With `CROCODE_CONFIG_DIR` set and no `GITHUB_CLIENT_ID`, the dashboard serves `/setup`.
At startup it writes a random token to `setup-token` in that directory and prints the setup link.
The setup form requires this token, so only the operator can claim the instance.

1. The form checks the token, the public address, and the app name.
2. The browser posts a GitHub App manifest to GitHub. The manifest `state` holds an HMAC keyed by the token.
3. GitHub sends the browser to `/setup/callback`. The dashboard checks the state and exchanges the one-time code.
4. The dashboard writes `github-app.json` with mode 0640 and deletes the token.

The file holds the app ID, private key, webhook secret, OAuth client, and a generated
`BETTER_AUTH_SECRET`. The API and worker mount the volume read-only and read it
through group 10000. They cannot read the setup token.
After setup, `/setup` redirects to the done page and the callback returns 409.
Environment variables take precedence over every stored value.

The dashboard container can write to this volume, so it holds the GitHub App private key.
To keep the private key out of the dashboard, configure the app by hand with environment variables.

## Sessions and requests

[Better Auth](https://better-auth.com) runs GitHub sign-in in stateless mode.
The dashboard has no database. Better Auth keeps the session and the GitHub
account in encrypted, httpOnly cookies with the `crocode.` prefix.
The account cookie holds the GitHub user access token. Only server code reads it.
OAuth sign-in uses state and PKCE. The state cookie expires after ten minutes.

The routes that return OAuth tokens, `/api/auth/get-access-token` and
`/api/auth/refresh-token`, are disabled. `/api/auth/get-session` returns no tokens.
The GitHub user gets a placeholder email, `<github-id>@github.invalid`.
Real email addresses are not read into the session.

Sessions last eight hours, the lifetime of a GitHub App user access token.
Token refresh is disabled. GitHub rotates refresh tokens, and a server
component cannot save the new cookie. Sign in again after expiry.
Changing `BETTER_AUTH_SECRET` ends all existing sessions.
Better Auth telemetry is off. Do not set `BETTER_AUTH_TELEMETRY`.
Without a database, Better Auth also writes each sign-in to an in-memory store.
The dashboard creates one Better Auth instance per request, so that store does
not grow. For the same reason, Better Auth's in-memory rate limit does not apply.
Rate-limit `/api/auth/*` at the reverse proxy if you need it.

Every API request uses bearer authentication, a 15-second timeout, and no cache.
An expired token or an API 401 response sends the user to `/?auth=expired`.
Sign-in and sign-out are Server Actions. Both require an Origin header that
matches `BETTER_AUTH_URL`. A reverse proxy must preserve the public Host or
X-Forwarded-Host value.

Settings saves check `can_admin` again on the server. They validate the selected
agent against `/api/v1/agents`. An empty model becomes `null`.
Review summaries, finding bodies, and suggestions render as escaped text.

## Checks

1. Run `bun run lint`.
2. Run `bun run typecheck`.
3. Run `bun test`.
4. Run `bun run build`.
5. Run `bun run scripts/smoke.ts`.

The smoke script starts the built standalone server and a local mock API.
It runs the Better Auth GitHub callback against a fake GitHub to create session
cookies. It checks authentication redirects, settings saves, the admin guard,
pagination, review text escaping, empty pages, missing pages, API 401 handling,
expired tokens, the disabled token routes, OAuth state rejection, and the
sign-in and sign-out origin checks. It does not contact GitHub. It stops both servers when it finishes.
Set `CROCODE_SMOKE_RUNTIME=node` to check the same standalone output with Node.

## Docker

1. Build from the repository root: `docker build -t crocode-web web`.
2. Supply the six environment variables at runtime.
3. Publish container port 3000.

The multi-stage image uses official `oven/bun:1.3.14` images for install, build,
and runtime. It runs Next.js standalone output as the non-root `bun` user.
The base image supports ARM64 and AMD64. ARM64 build and startup were checked.
The Docker context excludes local environment files, dependencies, and build output.

## Contract and limits

The dashboard follows `docs/api.md`.
Review pages group findings by file and show them next to the reviewed diff.
Suggested changes show a diff against the stored lines when available.
The API stores patches and findings in one transaction. Migration
`0002_review_files.sql` adds patch storage. The API applies it at startup.
Older reviews and files without a usable stored patch use a plain finding list.
Patches over 256 KiB per file are not stored.
History loads 20 reviews per page. “Load older” opens the next cursor page.
The API cursor is a timestamp. It cannot distinguish reviews with identical
`created_at` values at a page boundary.
The dashboard does not poll running reviews. Reload the page for updated status.
Real GitHub sign-in needs the deployed GitHub App credentials and was not checked
with a live account. Keyboard behavior, screen-reader output, and phone layout
still need a browser check.

The OSV scan found no advisories in the 21 distinct package versions found in the
standalone runtime. This scan does not cover system packages in the Docker image.
OSV reported no advisories for `better-auth` 1.7.15 and `@better-auth/core` 1.7.15
when Better Auth was added. The standalone runtime was not scanned again.
The full lockfile scan found `minimatch` 3.1.5 and 10.2.6 in the development lint
tree, affected by [GHSA-g3hv-75wg-m249](https://osv.dev/vulnerability/GHSA-g3hv-75wg-m249)
(CVE-2026-118764). OSV supplies vector
`CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N`.
Its affected range starts at 0 and is fixed at 11.0.1. No cross-major override
is applied to the lint dependencies. Bun also reports ESLint 10 peer-range
warnings in that tree. The lint command passes.

## Source references

- [Coss setup](https://coss.com/ui/docs/get-started.md): components were installed with its documented shadcn CLI method.
- [Better Auth stateless sessions](https://better-auth.com/docs/concepts/session-management#stateless-session-management): cookie cache and account cookie.
- [Better Auth GitHub provider](https://better-auth.com/docs/authentication/github): callback path and email handling.
- [Better Auth with Next.js](https://better-auth.com/docs/integrations/next): route handler and `nextCookies`.
- [Bun with Next.js](https://bun.sh/docs/guides/ecosystem/nextjs): Next.js scripts select the Bun runtime explicitly.
- [Bun Docker images](https://bun.sh/docs/guides/ecosystem/docker): official image and non-root user.
