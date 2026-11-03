import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { asset, DOCS_SITE_URL } from "@/lib/docs-site";

const GITHUB_URL = "https://github.com/kacigaya/crocode";
const DESCRIPTION =
  "Self-hostable AI code review for GitHub. Run Claude Code, Codex, or OpenCode in a read-only container with your own subscription.";

export const metadata: Metadata = {
  title: { absolute: "CroCode · Self-hosted AI code review for GitHub" },
  description: DESCRIPTION,
  alternates: { canonical: `${DOCS_SITE_URL}/` },
  openGraph: { type: "website", url: `${DOCS_SITE_URL}/`, title: "CroCode", description: DESCRIPTION },
};

const FEATURES = [
  {
    title: "Use your subscription",
    description: "Run reviews on your Claude or ChatGPT plan. API keys also work.",
  },
  {
    title: "Read-only agents",
    description: "The agent runs in a locked container with a read-only checkout and no GitHub token.",
  },
  {
    title: "Checked findings",
    description: "CroCode drops findings outside the diff, removes duplicates, and redacts secrets.",
  },
  {
    title: "Static analysis hints",
    description: "OpenGrep scans changed files in an offline sandbox before the agent reviews them.",
  },
  {
    title: "Inline comments",
    description: "Each finding has a severity and a suggested fix. CroCode never approves or blocks a pull request.",
  },
  {
    title: "Repository policy",
    description: "Set the agent, severity, limits, and ignore patterns in .crocode.yml on the base branch.",
  },
  {
    title: "Dashboard",
    description: "Sign in with GitHub to set review defaults, follow review history, and retry failed reviews.",
  },
  {
    title: "Your infrastructure",
    description: "Self-host the API, workers, and dashboard with Docker Compose on ARM64 or AMD64.",
  },
];

const INSTALL = `git clone https://github.com/kacigaya/crocode.git
cd crocode
cp .env.example .env
sudo docker build -t crocode-sandbox:latest docker/sandbox
sudo docker compose --profile dashboard up -d --build`;

const CONFIG = `agent: claude
min_severity: low
max_comments: 20
review_drafts: false
ignore:
  - "docs/**"
instructions: |
  Focus on authentication and data loss.`;

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 py-24 text-center">
          <Image src={asset("/logo.svg")} alt="" width={112} height={81} priority className="mb-8 h-20 w-auto" />
          <Badge variant="secondary" className="mb-6">
            Rust · Next.js · Docker
          </Badge>
          <h1 className="text-balance text-5xl font-bold tracking-tight sm:text-6xl">
            AI code review on your own servers
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
            CroCode reviews GitHub pull requests with Claude Code, Codex, or OpenCode. It checks every
            finding against the diff and posts inline comments with suggested fixes.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button size="xl" render={<Link href="/docs" />}>
              View Documentation
            </Button>
            <Button size="xl" variant="outline" render={<a href={GITHUB_URL} />}>
              Star on GitHub
            </Button>
          </div>
        </section>

        <section aria-label="Install" className="mx-auto w-full max-w-3xl px-6 pb-24">
          <CodeBlock label="Terminal" lang="bash" code={INSTALL} />
          <p className="text-pretty text-center text-sm text-muted-foreground">
            Set your agent credentials in <code className="font-mono">.env</code> before you start. Read the{" "}
            <Link href="/docs/getting-started/quickstart" className="text-brand underline underline-offset-3">
              Quickstart
            </Link>{" "}
            for all steps.
          </p>
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 pb-24">
          <h2 className="mb-10 text-balance text-center text-3xl font-bold tracking-tight">
            Code review you control
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <Card key={feature.title}>
                <CardHeader>
                  <CardTitle render={<h3 />}>{feature.title}</CardTitle>
                  <CardDescription render={<p />}>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-3xl px-6 pb-24">
          <h2 className="mb-6 text-balance text-center text-3xl font-bold tracking-tight">
            Configure each repository
          </h2>
          <CodeBlock label=".crocode.yml" lang="yaml" code={CONFIG} />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
