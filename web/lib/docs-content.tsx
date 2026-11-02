import type { ReactNode } from "react";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import type { DocHref } from "./docs-nav";
import { asset, DOCS_URL } from "./docs-site";

export interface DocSection {
  id: string;
  title: string;
  content: ReactNode;
}

function Note({ children }: { children: ReactNode }) {
  return <aside className="my-6 rounded-lg border-l-2 border-brand bg-muted px-5 py-1 text-sm">{children}</aside>;
}

function Table({ headings, rows }: { headings: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-5 overflow-x-auto rounded-lg border" role="region" aria-label={headings.join(", ")} tabIndex={0}>
      <table>
        <thead><tr>{headings.map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export const DOCS_CONTENT: Record<DocHref, DocSection[]> = {
  "/docs": [
    {
      id: "what-is-crocode", title: "What is CroCode?",
      content: <>
        <p>CroCode reviews GitHub pull requests with Claude Code, Codex, or OpenCode. You run the API, workers, database, and dashboard on your own servers.</p>
        <p>Each agent gets a read-only checkout. CroCode checks the findings against the diff, removes duplicates, and posts inline comments with severity levels and suggested fixes.</p>
        <Note><p>CroCode is in development. No release is published yet. Model providers receive code and review context. Read the <Link href="/docs/security">security guide</Link> before you review untrusted code.</p></Note>
      </>,
    },
    {
      id: "first-review", title: "Run your first review",
      content: <>
        <ol>
          <li><Link href="/docs/getting-started/quickstart">Start the stack</Link> with Docker Compose.</li>
          <li>Create a GitHub App through the setup page. Install it on selected repositories.</li>
          <li>Add your agent credentials to the worker environment.</li>
          <li>Open a small pull request. Follow the review in the <Link href="/docs/dashboard">dashboard</Link>.</li>
        </ol>
      </>,
    },
    {
      id: "review-policy", title: "Set your review policy",
      content: <>
        <p>Add <code>.crocode.yml</code> to the default branch. CroCode reads this file from the pull request base commit. A pull request cannot change its own review policy.</p>
        <CodeBlock label=".crocode.yml" code={'agent: claude\nmin_severity: low\nmax_comments: 20\nreview_drafts: false\nignore:\n  - "docs/**"\ninstructions: |\n  Focus on authentication and data loss.'} />
        <p>All fields are optional. See <Link href="/docs/configuration/repository">repository config</Link> for defaults and selection rules.</p>
      </>,
    },
    {
      id: "review-behavior", title: "What to expect",
      content: <>
        <p>A new push cancels the previous review. CroCode does not queue the same repository, pull request, and head commit twice, including when the previous review was skipped.</p>
        <p>The bot posts a <code>COMMENT</code> review. It never approves a pull request or requests changes. A person must check each suggestion before applying it.</p>
        <p>Use the <Link href="/docs/api-reference">REST API</Link> to read installations and findings. Use <Link href="/docs/development">the development guide</Link> to build and test CroCode.</p>
      </>,
    },
  ],
  "/docs/getting-started/quickstart": [
    {
      id: "requirements", title: "Requirements",
      content: <>
        <p>Use a Linux host with Docker Compose, a GitHub account, a public HTTPS address, and credentials for at least one <Link href="/docs/configuration/agents">agent</Link>. The images support ARM64 and AMD64.</p>
        <Note><p>The worker uses the Docker socket. This gives it effective control of the host. Use a dedicated host or Docker daemon for reviews.</p></Note>
        <p>To let a coding agent do these steps, open the repository in Claude Code or Codex and ask it to set up CroCode. The <code>crocode-setup</code> skill in <code>.agents/skills/</code> guides the agent. It asks before <code>sudo</code> commands and never shows secrets.</p>
      </>,
    },
    {
      id: "prepare", title: "1. Prepare the environment",
      content: <>
        <CodeBlock label="Terminal" code={'git clone https://github.com/kacigaya/crocode.git\ncd crocode\ncp .env.example .env\nchmod 600 .env\nstat -c \'%g\' /var/run/docker.sock'} />
        <ol>
          <li>Set separate <code>POSTGRES_PASSWORD</code> and <code>CROCODE_DB_PASSWORD</code> values in <code>.env</code>. Match the first to <code>MIGRATION_DATABASE_URL</code> and the second to <code>DATABASE_URL</code>.</li>
          <li>Set the model credentials for your agent. For a Claude subscription, set <code>CLAUDE_CODE_OAUTH_TOKEN</code> and leave <code>ANTHROPIC_API_KEY</code> empty.</li>
          <li>Set <code>DOCKER_GID</code> to the socket group ID printed by the command above.</li>
          <li>Leave the GitHub App values empty. The setup page creates them.</li>
        </ol>
        <p>The example enables Claude and OpenCode. Enable Codex only after you verify its <Link href="/docs/configuration/agents#codex">bubblewrap sandbox</Link> on your Docker host.</p>
      </>,
    },
    {
      id: "start", title: "2. Build and start CroCode",
      content: <>
        <p>Create the work directory with the worker UID and GID. Its absolute path must match on the host and inside the worker.</p>
        <CodeBlock label="Terminal" code={'sudo install -d -m 0755 -o 10000 -g 10000 /var/lib/crocode/work\nsudo docker build -t crocode-sandbox:latest docker/sandbox\nsudo docker compose --profile dashboard up -d --build'} />
        <p>Postgres stores review jobs and findings. The API and worker wait for the GitHub App credentials from setup. Do not put dashboard secrets in the backend <code>.env</code>.</p>
      </>,
    },
    {
      id: "https", title: "3. Set up HTTPS",
      content: <>
        <p>Put an HTTPS reverse proxy in front of the services. Use one public origin for setup and sign-in.</p>
        <Table headings={["Public path", "Service"]} rows={[
          [<code key="webhook">/webhooks/github</code>, "Rust API on port 8080"],
          ["All other paths", "Dashboard on port 3000"],
        ]} />
        <p>Preserve the public <code>Host</code> or <code>X-Forwarded-Host</code> header. The dashboard checks request origins for sign-in and settings changes.</p>
      </>,
    },
    {
      id: "github-app", title: "4. Create the GitHub App",
      content: <>
        <CodeBlock label="Terminal" code="sudo docker compose logs web | grep setup" />
        <ol>
          <li>Open the setup link on your public address. Keep its token private.</li>
          <li>Confirm the public address and app name. Select <strong>Create the GitHub App</strong>.</li>
          <li>Confirm the app creation on GitHub. CroCode saves the credentials.</li>
          <li>Follow the done page to install the app, upload the logo, and sign in.</li>
          <li>Open a small pull request in an installed repository. Check its review history in the dashboard.</li>
        </ol>
        <p>To use an existing app or keep its private key out of the dashboard, follow <Link href="/docs/getting-started/github-app">manual GitHub App setup</Link>.</p>
      </>,
    },
  ],
  "/docs/getting-started/github-app": [
    {
      id: "automatic-setup", title: "Create an app through setup",
      content: <>
        <p>The <Link href="/docs/getting-started/quickstart">quickstart</Link> uses GitHub App manifests. CroCode creates the app with the required permissions and saves its credentials in the shared config volume.</p>
        <p>The setup link requires a random token from the dashboard logs. Setup consumes that token after it saves the app. Environment variables take priority over saved values.</p>
        <p>GitHub has no app-logo API. Upload <a href={asset("/crocode-app-logo.png")} download>the CroCode app logo</a> in the app settings.</p>
      </>,
    },
    {
      id: "manual-setup", title: "Configure an app by hand",
      content: <>
        <ol>
          <li>Open GitHub <strong>Settings → Developer settings → GitHub Apps → New GitHub App</strong>.</li>
          <li>Choose a unique name. Set the homepage to your public site or the project repository.</li>
          <li>Set the OAuth callback to <code>https://YOUR_HOST/api/auth/callback/github</code>. Use your actual host.</li>
          <li>Enable the webhook at <code>https://YOUR_HOST/webhooks/github</code>. Keep SSL verification enabled.</li>
          <li>Generate a webhook secret with <code>openssl rand -hex 32</code>. Save it in GitHub and as <code>GITHUB_WEBHOOK_SECRET</code> in the backend environment.</li>
          <li>Set the permissions below. Subscribe to <strong>Pull request</strong> events. GitHub sends installation events by default.</li>
          <li>Create the app. Save its numeric App ID as <code>GITHUB_APP_ID</code>. Generate a private key.</li>
          <li>Install the app on selected repositories.</li>
        </ol>
      </>,
    },
    {
      id: "permissions", title: "Required permissions",
      content: <Table headings={["Permission", "Access", "Purpose"]} rows={[
        ["Repository contents", "Read-only", "Read code and base-commit config."],
        ["Pull requests", "Read and write", "Read diffs and publish COMMENT reviews."],
        ["Repository metadata", "Read-only", "Identify repositories. GitHub includes this permission."],
        ["Organization members", "Read-only", "Check installation admin rights in the dashboard."],
      ]} />,
    },
    {
      id: "credentials", title: "Store credentials",
      content: <>
        <p>The API and worker need the App ID, webhook secret, and private key. Put the PEM contents in <code>GITHUB_PRIVATE_KEY</code> with literal <code>{"\\n"}</code> between lines. You can instead mount a read-only PEM file in both services and set <code>GITHUB_PRIVATE_KEY_PATH</code>.</p>
        <p>The dashboard needs its own environment file. Copy <code>web/.env.example</code> to <code>web/.env</code> for Compose. Set its GitHub client ID, client secret, app slug, auth secret, and public URL. Compose supplies the API URL.</p>
        <p>Keep user token expiration enabled. The dashboard uses GitHub App user access tokens. It does not need the email permission.</p>
        <Note><p>Never pass the App private key, webhook secret, user tokens, or dashboard secrets to the agent sandbox.</p></Note>
      </>,
    },
    {
      id: "verify", title: "Check webhook delivery",
      content: <>
        <p>Use the webhook delivery view in GitHub App settings. A signed ping returns <code>202</code> with <code>pong</code>. An invalid signature returns <code>401</code>. A repeat of an accepted delivery ID returns <code>200</code> with <code>duplicate delivery</code>.</p>
        <p>See the <a href="https://github.com/kacigaya/crocode/blob/main/docs/github-app.md">full manual setup reference</a> for key storage and account options.</p>
      </>,
    },
  ],
  "/docs/configuration/repository": [
    {
      id: "config-file", title: "The .crocode.yml file",
      content: <>
        <p>Place <code>.crocode.yml</code> on the default branch. CroCode reads it from the pull request base commit. An absent or blank file uses the defaults. Invalid YAML, unknown fields, or invalid ignore patterns fail the review without a retry.</p>
        <CodeBlock label=".crocode.yml" code={'enabled: true\nagent: claude\nmodel: null\nreview_drafts: false\nmin_severity: low\nmax_comments: 20\nmax_files: 100\nmax_changed_lines: 3000\nignore:\n  - "docs/**"\ninstructions: |\n  Focus on authentication and data loss.'} />
      </>,
    },
    {
      id: "fields", title: "Fields and defaults",
      content: <Table headings={["Field", "Default", "Behavior"]} rows={[
        [<code key="enabled">enabled</code>, <code key="true">true</code>, "False records a skipped review."],
        [<code key="agent">agent</code>, <code key="null">null</code>, "claude, codex, or opencode. Must be enabled on the server."],
        [<code key="model">model</code>, <code key="null">null</code>, "Model name. See the selection rules below."],
        [<code key="drafts">review_drafts</code>, <code key="false">false</code>, "Include draft pull requests."],
        [<code key="severity">min_severity</code>, <code key="low">low</code>, "info, low, medium, high, or critical."],
        [<code key="comments">max_comments</code>, "20", "Inline finding limit. Values above 50 become 50. Other findings stay in the summary."],
        [<code key="files">max_files</code>, "100", "Changed file limit before ignore filtering. Includes removed files and files without patches."],
        [<code key="lines">max_changed_lines</code>, "3000", "Added plus deleted lines after filtering."],
        [<code key="ignore">ignore</code>, <code key="empty">[]</code>, "Extra globs added to the built-in ignores."],
        [<code key="instructions">instructions</code>, <code key="null">null</code>, "Maintainer guidance. CroCode keeps the first 4,000 characters."],
      ]} />,
    },
    {
      id: "selection", title: "Agent and model selection",
      content: <>
        <ol>
          <li>The repository agent overrides the installation agent and server default.</li>
          <li>An explicit repository agent resets the installation model.</li>
          <li>Without a repository agent, a repository model overrides the installation model.</li>
          <li>An absent model uses the selected agent’s default.</li>
        </ol>
        <p>Model names must contain 1 to 100 ASCII characters. Letters, digits, and <code>._:/@#-[]</code> are allowed. A model name cannot start with <code>-</code>.</p>
      </>,
    },
    {
      id: "ignored-files", title: "Ignored files",
      content: <>
        <p>These patterns always apply:</p>
        <CodeBlock label="Default ignore patterns" code={'**/*.lock\n**/package-lock.json\n**/pnpm-lock.yaml\n**/*.min.js\n**/*.map\n**/*.snap\n**/vendor/**\n**/node_modules/**'} />
        <p>Ignore patterns exclude findings for a file. They do not remove it from the checkout sent to the model. Removed files and files without GitHub patches are not reviewed.</p>
        <p>GitHub returns at most 3,000 files through its file endpoint. Keep <code>max_files</code> below that limit.</p>
      </>,
    },
  ],
  "/docs/configuration/server": [
    {
      id: "environment", title: "Environment files",
      content: <>
        <p>Compose reads the backend <code>.env</code> for variable substitution. The worker loads it through <code>env_file</code>. The API receives only its named variables and no model credentials. Compose clears database setup credentials from the worker environment.</p>
        <p>Keep dashboard secrets in <code>web/.env</code>. Compose sets <code>CROCODE_API_URL=http://api:8080</code>. For local web development, use <code>web/.env.local</code>.</p>
        <p>Existing databases need a one-time account setup before this upgrade. Follow the <a href="https://github.com/kacigaya/crocode/blob/main/docs/configuration.md#database-setup-and-upgrades">database upgrade steps</a>. Keep the existing database volume.</p>
        <p>The Rust binary reads environment variables at startup. It does not load <code>.env</code> itself. Compose runs <code>crocode migrate</code> before the API and worker start. Runtime services use a restricted database account.</p>
      </>,
    },
    {
      id: "core-settings", title: "Core settings",
      content: <Table headings={["Variable", "Default", "Purpose"]} rows={[
        [<code key="db">DATABASE_URL</code>, "Required", "Restricted Postgres runtime account. Privileged roles are rejected."],
        [<code key="migrationdb">MIGRATION_DATABASE_URL</code>, "Migration process only", "Setup account for crocode migrate. Keep it out of runtime services."],
        [<code key="bind">CROCODE_BIND</code>, "0.0.0.0:8080", "API listen address."],
        [<code key="dir">CROCODE_CONFIG_DIR</code>, "Unset", "Directory containing github-app.json. Compose uses /config."],
        [<code key="id">GITHUB_APP_ID</code>, "Required without setup", "Numeric App ID. Enables environment-based GitHub settings."],
        [<code key="key">GITHUB_PRIVATE_KEY</code>, "Required without a key path", "App PEM key. Literal \\n becomes a line break."],
        [<code key="path">GITHUB_PRIVATE_KEY_PATH</code>, "Unset", "PEM file path. Takes priority over the inline key. Unset it when unused."],
        [<code key="secret">GITHUB_WEBHOOK_SECRET</code>, "Required without setup", "Webhook HMAC secret of at least 16 bytes."],
        [<code key="agents">CROCODE_AGENTS</code>, "claude,codex,opencode", "Enabled agents. Compose and .env.example enable claude,opencode."],
        [<code key="default">CROCODE_DEFAULT_AGENT</code>, "First enabled agent", "Must appear in CROCODE_AGENTS."],
        [<code key="githubapi">GITHUB_API_URL</code>, "https://api.github.com", "GitHub API base URL."],
        [<code key="githubweb">GITHUB_WEB_URL</code>, "https://github.com", "Git host for repository checkout."],
      ]} />,
    },
    {
      id: "worker-settings", title: "Worker and sandbox settings",
      content: <Table headings={["Variable", "Default", "Purpose"]} rows={[
        [<code key="sandbox">CROCODE_SANDBOX</code>, "docker", "Use none only for trusted local development."],
        [<code key="image">CROCODE_SANDBOX_IMAGE</code>, "crocode-sandbox:latest", "Image on the worker’s Docker daemon."],
        [<code key="network">CROCODE_SANDBOX_NETWORK</code>, "bridge", "Sandbox network. Does not create egress firewall rules."],
        [<code key="runtime">CROCODE_SANDBOX_RUNTIME</code>, "Unset", "Optional installed runtime, such as runsc."],
        [<code key="work">CROCODE_WORK_DIR</code>, "/var/lib/crocode/work", "Same absolute path on host and worker. Owner 10000:10000."],
        [<code key="slots">CROCODE_WORKER_CONCURRENCY</code>, "4", "Worker slots per process. Minimum 1."],
        [<code key="cap">CROCODE_MAX_PER_INSTALLATION</code>, "2", "Soft concurrency cap. Concurrent claims can exceed it."],
        [<code key="timeout">CROCODE_AGENT_TIMEOUT_SECS</code>, "900", "Agent timeout. Each Git command has a separate 300-second timeout."],
        [<code key="size">CROCODE_MAX_REPO_SIZE_MB</code>, "1024", "GitHub repository-size pre-check. This is not a disk quota."],
        [<code key="extra">CROCODE_AGENT_ENV</code>, "Empty", "Extra variable names passed to agents. Never include GitHub or dashboard secrets."],
        [<code key="logs">CROCODE_LOG_FORMAT</code>, "Plain text", "Set json for JSON logs."],
        [<code key="rust">RUST_LOG</code>, "info", "Tracing filter."],
      ]} />,
    },
    {
      id: "queue", title: "Queue behavior",
      content: <>
        <p>A job can run up to three attempts. Retry delay starts at 30 seconds, doubles, and stops growing at ten minutes. The worker polls every two seconds and sends a heartbeat every 20 seconds.</p>
        <p>The reaper checks every 60 seconds. It requeues jobs with heartbeats older than 120 seconds, or fails them when they reach the attempt limit. Delivery IDs expire after seven days.</p>
        <p>These values are code constants. See the <a href="https://github.com/kacigaya/crocode/blob/main/docs/configuration.md">full configuration reference</a> for Compose and retention details.</p>
      </>,
    },
  ],
  "/docs/configuration/agents": [
    {
      id: "choose-agent", title: "Choose an agent",
      content: <>
        <p>Set the enabled list with <code>CROCODE_AGENTS</code>. Choose the server default with <code>CROCODE_DEFAULT_AGENT</code>. Installation settings and <Link href="/docs/configuration/repository#selection">repository config</Link> can override it.</p>
        <Table headings={["Agent", "Read-only controls", "Credentials"]} rows={[
          ["Claude Code", "Read, Grep, and Glob tools only. Bare and restricted mode, or safe mode for subscription tokens.", "ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN"],
          ["Codex", "exec --sandbox read-only with an ephemeral session.", "CODEX_API_KEY"],
          ["OpenCode", "All permissions denied except read, glob, and grep. Pure mode disables external plugins.", "Provider key, such as OPENROUTER_API_KEY"],
        ]} />
      </>,
    },
    {
      id: "claude", title: "Claude Code",
      content: <>
        <p>Set <code>ANTHROPIC_API_KEY</code> on the worker to use an API key.</p>
        <p>To use a Claude subscription:</p>
        <ol>
          <li>Run <code>claude setup-token</code> with your own Claude CLI.</li>
          <li>Set the result as <code>CLAUDE_CODE_OAUTH_TOKEN</code> in the worker environment.</li>
          <li>Leave <code>ANTHROPIC_API_KEY</code> empty. A nonempty API key takes priority.</li>
        </ol>
        <p>Subscription reviews count against subscription usage limits. CroCode uses safe mode for this path because bare mode does not read OAuth credentials.</p>
      </>,
    },
    {
      id: "codex", title: "Codex",
      content: <>
        <p>Set <code>CODEX_API_KEY</code>. An alternative API endpoint can use <code>OPENAI_BASE_URL</code>.</p>
        <Note><p>Codex needs bubblewrap namespaces. The default Docker restrictions on the development host block them. The example disables Codex. Keep its read-only sandbox enabled.</p></Note>
        <p>Before enabling Codex, use a compatible dedicated runtime and repeat the read, blocked-write, and blocked-network probes. Do not add privileged mode or bypass the sandbox to hide a namespace failure.</p>
        <p>See the <a href="https://github.com/kacigaya/crocode/blob/main/docker/README.md">container build and verification notes</a> for the pinned CLI versions and known host limits.</p>
      </>,
    },
    {
      id: "opencode", title: "OpenCode",
      content: <>
        <p>Set the selected provider’s key. CroCode passes <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>, <code>OPENROUTER_API_KEY</code>, and <code>OPENCODE_API_KEY</code> when present.</p>
        <p>CroCode supplies a fixed permission config. It disables project config, Claude config, external skills, and external plugins. These controls prevent repository files from adding startup code.</p>
      </>,
    },
    {
      id: "credential-boundary", title: "Credential boundary",
      content: <>
        <p>Only the selected agent’s listed model variables and explicit <code>CROCODE_AGENT_ENV</code> names enter the sandbox. The agent can read its own model key.</p>
        <p>Never pass GitHub tokens, private keys, database URLs, OAuth secrets, or session secrets. Do not mount your personal CLI home. Use separate model keys with provider spending limits.</p>
      </>,
    },
  ],
  "/docs/dashboard": [
    {
      id: "sign-in", title: "Sign in with GitHub",
      content: <>
        <p>Open your CroCode address and select <strong>Sign in with GitHub</strong>. App installation and user authorization are separate actions. You must authorize user access to use the dashboard.</p>
        <p>Sessions last eight hours. Sign in again after expiry. CroCode keeps tokens in encrypted, httpOnly cookies. Browser code does not receive them.</p>
      </>,
    },
    {
      id: "installations", title: "Manage installations",
      content: <>
        <ol>
          <li>Choose an installation from the overview or sidebar.</li>
          <li>Open the <strong>Settings</strong> tab.</li>
          <li>Turn reviews on or off.</li>
          <li>Choose an enabled agent.</li>
          <li>Choose a model from the list, or type a model name. Leave the model blank to use the agent default.</li>
          <li>Save the settings.</li>
        </ol>
        <p>The model list shows the models that each agent CLI reports. The worker checks them at start and every 6 hours.</p>
        <p>The <strong>Overview</strong> tab shows open pull requests and the state of their newest review. It also shows review totals, reviews per day, and findings by severity for the last 30 days.</p>
        <p>Only the account owner or an active organization admin can change settings. The server checks this access again when you save. Repository config can override the installation’s agent and model.</p>
      </>,
    },
    {
      id: "reviews", title: "Read a review",
      content: <>
        <p>Open a review from the installation overview. The page shows the pull request state, branches, and size from GitHub. The <strong>Summary</strong> tab shows the agent summary, agent, model, and attempts. The <strong>Findings</strong> tab shows each finding in its diff. The <strong>Timeline</strong> tab lists every review of the pull request.</p>
        <Table headings={["Status", "Meaning"]} rows={[
          ["queued", "Waiting for a worker."], ["running", "A worker claimed the job."],
          ["succeeded", "The review finished."], ["failed", "The job failed."],
          ["cancelled", "The job was cancelled, for example after a new push."],
          ["skipped", "Review policy skipped the job."],
        ]} />
        <p>Check the error text for failed reviews. The current API has no manual rerun endpoint. A head commit that already has a queue row is not queued again.</p>
      </>,
    },
    {
      id: "local-setup", title: "Run the dashboard locally",
      content: <>
        <CodeBlock label="Terminal · web/" code="bun install --frozen-lockfile\ncp .env.example .env.local\nbun run dev" />
        <p>Set all six values in <code>.env.local</code>: <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>, <code>GITHUB_APP_SLUG</code>, <code>BETTER_AUTH_SECRET</code>, <code>BETTER_AUTH_URL</code>, and <code>CROCODE_API_URL</code>.</p>
        <p>The auth secret needs at least 32 characters. The auth URL must be an HTTP(S) origin with no path. Set the GitHub OAuth callback to that origin plus <code>/api/auth/callback/github</code>. Keep API calls and tokens in server code.</p>
        <p>The <a href={DOCS_URL}>public docs on GitHub Pages</a> need no sign-in or GitHub credentials.</p>
      </>,
    },
  ],
  "/docs/security": [
    {
      id: "trust-boundary", title: "Trust boundary",
      content: <>
        <p>Treat the pull request author, text, code, repository files, and agent output as untrusted. The operator, base-branch config, database, GitHub App key, and Docker daemon are trusted.</p>
        <Note><p>Self-hosting does not keep code away from the model provider. The provider receives code and review context. Sandbox network egress is open by default.</p></Note>
        <p>Prompt boundaries and read-only tools reduce risk. They do not prove that a model will ignore hostile instructions. Read-only files do not stop a process from executing code or sending network requests.</p>
      </>,
    },
    {
      id: "sandbox", title: "Sandbox controls",
      content: <Table headings={["Control", "Value"]} rows={[
        ["Root filesystem", "Read-only"], ["User", "10001:10001"], ["Linux capabilities", "All dropped"],
        ["Privilege escalation", "no-new-privileges"], ["Resources", "512 processes, 4 GiB memory, 2 CPUs"],
        ["Repository and inputs", "/repo:ro and /input:ro"], ["Result directory", "/output:rw"],
        ["Temporary files and agent home", "Separate 512 MiB tmpfs mounts with nosuid,nodev"],
      ]} />,
    },
    {
      id: "credentials", title: "Credentials and checkout",
      content: <>
        <p>The API checks webhook HMAC SHA-256 before parsing or recording an event. The worker creates a token scoped to one repository. Git receives it through environment config, not a URL or command argument.</p>
        <p>The worker removes <code>.git</code> before starting the agent. It does not fetch submodules. Repository symlinks become plain text files. The sandbox receives no GitHub token, App key, Docker socket, or dashboard secret.</p>
        <p>The worker redacts known passed secrets of at least eight bytes before storage. This covers exact strings. It does not cover encoded, split, transformed, or unknown secrets.</p>
      </>,
    },
    {
      id: "publication", title: "Finding validation",
      content: <>
        <p>Findings must use normalized paths from the reviewed diff. Inline comments need RIGHT-side lines. A multiline range must stay in one hunk. Other valid findings move to the summary.</p>
        <p>CroCode escapes HTML, disables Markdown images, breaks mentions, removes control characters, and limits output length. It removes previously published finding fingerprints.</p>
        <p>Ordinary links remain. Check their destinations before following them. Sanitization is not complete data-loss prevention. A person must review suggested patches.</p>
      </>,
    },
    {
      id: "host-and-network", title: "Host and network isolation",
      content: <>
        <ol>
          <li>Use a dedicated host or Docker daemon. Give socket access only to the worker.</li>
          <li>Keep host credentials and unrelated data off that host.</li>
          <li>Use a private work directory and a filesystem disk quota.</li>
          <li>Put sandboxes on a dedicated network. Deny direct egress and allow model traffic through a restricted proxy.</li>
          <li>Check an allowed provider connection and a blocked destination before use.</li>
        </ol>
        <p>Choosing a Docker network does not create firewall rules. A read-only worker UID does not remove Docker socket risk. An optional <code>runsc</code> runtime requires separate installation and testing.</p>
      </>,
    },
    {
      id: "known-limits", title: "Known limits",
      content: <>
        <p>The worker removes completed reviews after 30 days. It removes deleted installations’ reviews on its next cleanup pass. Cleanup runs once per minute and removes findings and patches too. Active jobs remain unless their installation is deleted. Protect the database and its backups as source-code data. Backups and GitHub reviews need a separate retention policy. A host crash can leave checkout files behind.</p>
        <p>Cancellation can take until the next heartbeat. The installation concurrency cap is soft. A crash between GitHub publication and its database update can cause a duplicate review on retry.</p>
        <p>Read the <a href="https://github.com/kacigaya/crocode/blob/main/docs/security.md">full security model</a> for verification results and dependency advisories.</p>
      </>,
    },
  ],
  "/docs/api-reference": [
    {
      id: "authentication", title: "Authentication and errors",
      content: <>
        <p>The Rust API listens on port 8080. Send a GitHub App user access token as a bearer token. The dashboard calls the API from the server only.</p>
        <CodeBlock label="HTTP header" code="Authorization: Bearer <github user access token>" />
        <p>The API checks accessible installations with GitHub and caches access for 60 seconds. It does not store user tokens in Postgres.</p>
        <CodeBlock label="JSON error" code={'{ "error": "message" }'} />
        <p>Errors use <code>401</code> for a missing or invalid token, <code>403</code> for no access, <code>404</code> for an unknown ID, and <code>422</code> for invalid input.</p>
      </>,
    },
    {
      id: "endpoints", title: "Endpoints",
      content: <Table headings={["Method", "Path", "Result"]} rows={[
        ["GET", <code key="health">/healthz</code>, "No authentication. Returns ok."],
        ["GET", <code key="me">/api/v1/me</code>, "Signed-in user ID and login."],
        ["GET", <code key="agents">/api/v1/agents</code>, "Enabled agents, server default, and detected models."],
        ["GET", <code key="installs">/api/v1/installations</code>, "Accessible installations that exist in the database."],
        ["GET", <code key="install">/api/v1/installations/{"{id}"}</code>, "One accessible installation."],
        ["PATCH", <code key="settings">/api/v1/installations/{"{id}"}/settings</code>, "Update settings. Requires can_admin."],
        ["GET", <code key="reviews">/api/v1/installations/{"{id}"}/reviews</code>, "Review history, newest first. Filter by repo and pr."],
        ["GET", <code key="stats">/api/v1/installations/{"{id}"}/stats</code>, "Review totals for the last 30 days."],
        ["GET", <code key="pulls">/api/v1/installations/{"{id}"}/pulls</code>, "Open pull requests with their newest review."],
        ["GET", <code key="review">/api/v1/reviews/{"{id}"}</code>, "One review with its summary and findings."],
        ["GET", <code key="review-pull">/api/v1/reviews/{"{id}"}/pull</code>, "Live pull request details from GitHub."],
      ]} />,
    },
    {
      id: "installations", title: "Installations and settings",
      content: <>
        <CodeBlock label="JSON · installation" code={'{\n  "id": 123,\n  "account_login": "acme",\n  "account_type": "Organization",\n  "repository_selection": "selected",\n  "suspended": false,\n  "created_at": "2026-11-01T10:00:00Z",\n  "settings": { "enabled": true, "agent": "claude", "model": null },\n  "can_admin": true\n}'} />
        <p><code>can_admin</code> is true for the account owner or an organization admin. A null agent uses the server default. A null model uses the selected agent’s default.</p>
        <p>All fields in the settings PATCH body are optional. The response is the updated installation.</p>
        <CodeBlock label="JSON · settings PATCH body" code={'{ "enabled": true, "agent": "claude", "model": null }'} />
      </>,
    },
    {
      id: "review-history", title: "Review history",
      content: <>
        <p>Use <code>limit</code> from 1 to 100. The default is 50. Supply an RFC 3339 timestamp as <code>before</code> for older reviews. Add <code>repo</code> and <code>pr</code> together to list the reviews of one pull request.</p>
        <CodeBlock label="Request path" code="/api/v1/installations/123/reviews?limit=50&before=2026-11-01T10:00:00Z" />
        <CodeBlock label="JSON · review list" code={'[\n  {\n    "id": "6f1c0b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",\n    "installation_id": 123,\n    "repo_full_name": "acme/api",\n    "pr_number": 42,\n    "pr_title": "Add login",\n    "head_sha": "abc123...",\n    "status": "succeeded",\n    "agent": "claude",\n    "model": null,\n    "attempts": 1,\n    "finding_count": 3,\n    "error": null,\n    "created_at": "2026-11-01T10:00:00Z",\n    "finished_at": "2026-11-01T10:03:00Z"\n  }\n]'} />
        <p>Status is <code>queued</code>, <code>running</code>, <code>succeeded</code>, <code>failed</code>, <code>cancelled</code>, or <code>skipped</code>. The agent is null until a worker selects one.</p>
      </>,
    },
    {
      id: "findings", title: "Review details and findings",
      content: <>
        <p>The detail response has <code>review</code>, <code>summary</code>, and <code>findings</code> fields. The review uses the same shape as a history item. Each finding uses this shape:</p>
        <CodeBlock label="JSON · finding" code={'{\n  "id": "finding-id",\n  "path": "src/auth.rs",\n  "start_line": null,\n  "line": 120,\n  "severity": "high",\n  "category": "security",\n  "title": "Token compared with ==",\n  "body": "Explanation",\n  "suggestion": null,\n  "published": true\n}'} />
        <p>Severity is <code>critical</code>, <code>high</code>, <code>medium</code>, <code>low</code>, or <code>info</code>. Suggestions contain replacement code or null.</p>
        <p>The <a href="https://github.com/kacigaya/crocode/blob/main/docs/api.md">API contract in the repository</a> is the source reference for clients.</p>
      </>,
    },
  ],
  "/docs/development": [
    {
      id: "layout", title: "Project layout",
      content: <Table headings={["Path", "Purpose"]} rows={[
        [<code key="core">crates/core</code>, "Pure review logic: config, diff parsing, finding validation, and prompts. No I/O."],
        [<code key="server">crates/server</code>, "Axum API, GitHub client, Postgres queue, worker, and sandbox runner."],
        [<code key="web">web</code>, "Next.js dashboard and documentation. Bun is the package manager and test runner."],
        [<code key="migrations">migrations</code>, "SQLx migrations applied by crocode migrate before runtime startup."],
        [<code key="sandbox">docker/sandbox</code>, "Read-only agent image."],
      ]} />,
    },
    {
      id: "rust", title: "Rust checks",
      content: <>
        <p>Use Rust 1.89 or newer. Run from the repository root:</p>
        <CodeBlock label="Terminal" code="cargo fmt --all --check\ncargo clippy --all-targets -- -D warnings\ncargo test --all" />
        <p>Plain tests skip database tests. To include them, set a reachable Postgres URL for a user that can create databases:</p>
        <CodeBlock label="Terminal · local test database" code={'DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres \\\n  cargo test --all -- --include-ignored'} />
        <p>Port 55432 belongs to the development host’s test database. Compose does not publish its database port. Use your own reachable URL on other hosts.</p>
      </>,
    },
    {
      id: "web", title: "Web checks",
      content: <>
        <p>Use Bun 1.3.14. Run from <code>web/</code>:</p>
        <CodeBlock label="Terminal · web/" code="bun install --frozen-lockfile\nbun run lint\nbun run typecheck\nbun test\nbun run build\nbun run scripts/smoke.ts" />
        <p>The smoke script starts the built standalone server and a mock API. It checks sign-in, permissions, settings, review pages, and error states without real GitHub or model calls.</p>
      </>,
    },
    {
      id: "images", title: "Container checks",
      content: <>
        <CodeBlock label="Terminal" code="sudo docker build -t crocode:latest .\nsudo docker build -t crocode-sandbox:latest docker/sandbox\nsudo docker compose config --quiet\nsudo docker compose --profile dashboard config --quiet" />
        <p>Use native AMD64 and ARM64 runners to verify both image architectures. Read the <a href="https://github.com/kacigaya/crocode/blob/main/docker/README.md">Docker guide</a> before changing CLI versions or sandbox flags.</p>
      </>,
    },
    {
      id: "docs", title: "Edit the documentation",
      content: <>
        <p>Docs navigation and page metadata live in <code>web/lib/docs-nav.ts</code>. Article sections live in <code>web/lib/docs-content.tsx</code>. The layout derives each page outline from those sections.</p>
        <p>Keep web guides aligned with <code>README.md</code>, <code>docs/</code>, and <code>docker/README.md</code>. Keep REST API examples aligned with <code>docs/api.md</code> and <code>crates/server/src/api.rs</code>.</p>
        <p>The articles use React components so the dashboard needs no Markdown runtime dependency. Add a Markdown pipeline only when the number of contributors or articles makes this format hard to maintain.</p>
        <p>Run <code>bun run build:docs</code> from <code>web/</code> to export the GitHub Pages site to <code>web/site/out</code>. Run <code>bun run scripts/check-docs-export.ts</code> to check the exported links and assets. The static app in <code>web/site</code> excludes dashboard and authentication routes.</p>
      </>,
    },
  ],
};
