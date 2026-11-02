# CroCode dashboard

The dashboard uses Next.js 16.4.3, React 19.3.1, Tailwind CSS 4, and Coss UI.
Use Bun 1.3.14. All dashboard files are in `web/`.

## Local setup

1. Run `bun install` in `web/`.
2. Copy `.env.example` to `.env.local`.
3. Set all six variables. `SESSION_SECRET` must contain at least 32 random characters. Keep it private and stable.
4. Set the GitHub App user OAuth callback to `${PUBLIC_URL}/api/auth/callback`.
5. Start the Rust API. Set `CROCODE_API_URL` to its server-side address.
6. Run `bun run dev`. Open the address set in `PUBLIC_URL`.

`PUBLIC_URL` must be an HTTP or HTTPS origin with no path. Use HTTPS in production.
Environment values are checked on first use. Builds do not need secrets.
The dashboard does not use `NEXT_PUBLIC_` variables.

## Sessions and requests

GitHub tokens stay on the server. The browser gets an AES-256-GCM encrypted,
httpOnly session cookie. SHA-256 derives the encryption key from `SESSION_SECRET`.
OAuth state uses a separate authenticated cookie purpose and expires after ten minutes.
The callback compares state with `timingSafeEqual`.

Sessions last up to eight hours. A shorter GitHub token expiry takes precedence.
The dashboard does not store or use refresh tokens. Sign in again after expiry.
Changing `SESSION_SECRET` ends all existing sessions.

Every API request uses bearer authentication, a 15-second timeout, and no cache.
API 401 responses redirect to `/api/auth/login`. That route clears the session
before it starts GitHub sign-in. It also clears expired or invalid sessions.
Logout requires a POST request whose Origin matches `PUBLIC_URL`.
Next.js checks the origin of Server Action requests. A reverse proxy must preserve
the public Host or X-Forwarded-Host value.

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
It uses temporary test credentials. It checks authentication redirects, settings
saves, the admin guard, pagination, review text escaping, empty pages, missing
pages, API 401 handling, OAuth state rejection, and logout CSRF protection.
It does not contact GitHub. It stops both servers when it finishes.
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

The dashboard follows `docs/api.md`. It makes no contract changes.
History loads 20 reviews per page. “Load older” opens the next cursor page.
The API cursor is a timestamp. It cannot distinguish reviews with identical
`created_at` values at a page boundary.
The dashboard does not poll running reviews. Reload the page for updated status.
Real GitHub sign-in needs the deployed GitHub App credentials and was not checked
with a live account. Keyboard behavior, screen-reader output, and phone layout
still need a browser check.

The OSV scan found no advisories in the 21 distinct package versions found in the
standalone runtime. This scan does not cover system packages in the Docker image.
The full lockfile scan found `minimatch` 3.1.5 and 10.2.6 in the development lint
tree, affected by [GHSA-g3hv-75wg-m249](https://osv.dev/vulnerability/GHSA-g3hv-75wg-m249)
(CVE-2026-118764). OSV supplies vector
`CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N`.
Its affected range starts at 0 and is fixed at 11.0.1. No cross-major override
is applied to the lint dependencies. Bun also reports ESLint 10 peer-range
warnings in that tree. The lint command passes.

## Source references

- [Coss setup](https://coss.com/ui/docs/get-started.md): components were installed with its documented shadcn CLI method.
- [Next.js cookies](https://nextjs.org/docs/app/api-reference/functions/cookies): cookie writes run in Route Handlers.
- [Bun with Next.js](https://bun.sh/docs/guides/ecosystem/nextjs): Next.js scripts select the Bun runtime explicitly.
- [Bun Docker images](https://bun.sh/docs/guides/ecosystem/docker): official image and non-root user.
