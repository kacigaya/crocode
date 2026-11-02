export const DOCS_NAV = [
  {
    title: "Getting started",
    items: [
      { title: "Introduction", href: "/docs", description: "Run AI code reviews for GitHub on your own infrastructure." },
      { title: "Quickstart", href: "/docs/getting-started/quickstart", description: "Start CroCode with Docker Compose and create your GitHub App." },
      { title: "GitHub App", href: "/docs/getting-started/github-app", description: "Configure GitHub permissions, webhooks, and dashboard sign-in." },
    ],
  },
  {
    title: "Configuration",
    items: [
      { title: "Repository config", href: "/docs/configuration/repository", description: "Set review policy, file limits, and ignore patterns in .crocode.yml." },
      { title: "Server config", href: "/docs/configuration/server", description: "Configure the API, worker, database, and sandbox environment." },
      { title: "Agents", href: "/docs/configuration/agents", description: "Choose Claude Code, Codex, or OpenCode and supply model credentials." },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "Dashboard", href: "/docs/dashboard", description: "Manage installation settings and read review findings in the dashboard." },
      { title: "Security", href: "/docs/security", description: "Understand the sandbox, credential boundaries, and data exposure limits." },
      { title: "REST API", href: "/docs/api-reference", description: "Authenticate and use the CroCode dashboard REST API." },
      { title: "Development", href: "/docs/development", description: "Build CroCode locally and run the Rust and web validation checks." },
    ],
  },
] as const;

export const DOCS_PAGES = DOCS_NAV.flatMap((section) => [...section.items]);
export type DocHref = (typeof DOCS_PAGES)[number]["href"];

export function findDoc(slug: readonly string[] = []) {
  const href = slug.length ? `/docs/${slug.join("/")}` : "/docs";
  return DOCS_PAGES.find((page) => page.href === href);
}
