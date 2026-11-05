import Image from "next/image";
import { redirect } from "next/navigation";
import { GitHubMark } from "@/components/github-mark";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { readSession } from "@/lib/auth";
import { setupAvailable } from "@/lib/config";
import { DOCS_URL } from "@/lib/docs-site";
import { signIn } from "./auth-actions";

const messages: Record<string, string> = {
  expired: "Your session has expired. Sign in again.",
  access_denied: "GitHub sign-in was cancelled. Sign in to continue.",
};

const features = [
  {
    title: "Read-only agents",
    body: "Claude Code, Codex, or OpenCode run in a locked container with a read-only checkout and no GitHub token.",
  },
  {
    title: "Checked findings",
    body: "CroCode drops findings outside the diff, removes duplicates, and posts inline comments with suggested fixes.",
  },
  {
    title: "Your infrastructure",
    body: "Self-host the API, workers, and dashboard with Docker Compose on ARM64 or AMD64.",
  },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string; error?: string }>;
}) {
  if (setupAvailable()) redirect("/setup");
  const { auth, error } = await searchParams;
  // `auth` is set when the API refused the token; stay here so the user can
  // sign in again instead of looping back to the dashboard.
  if (!auth && !error && (await readSession())) redirect("/installations");
  // Better Auth sends OAuth failures back as `?error=<code>`.
  const problem = auth ?? error;
  const message = problem
    ? Object.hasOwn(messages, problem)
      ? messages[problem]
      : "GitHub sign-in could not finish. Try again."
    : null;
  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <section className="mx-auto max-w-5xl px-6 pt-20 pb-16 text-center sm:pt-24">
          <Image
            src="/logo.svg"
            alt=""
            width={112}
            height={81}
            priority
            className="mx-auto"
          />
          <Badge variant="secondary" className="mt-8">
            Rust · Next.js · Docker
          </Badge>
          <h1 className="mt-5 text-balance text-4xl font-semibold sm:text-6xl">
            AI code review on your own servers
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-muted-foreground">
            CroCode reviews GitHub pull requests with the agent you choose.
            Manage installations, set review defaults, and read every finding
            from one dashboard.
          </p>
          {message && (
            <p
              role="alert"
              className="mx-auto mt-6 max-w-md rounded-lg border border-destructive/30 px-4 py-3 text-sm text-destructive-foreground"
            >
              {message}
            </p>
          )}
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <form action={signIn}>
              <Button size="xl" type="submit">
                <GitHubMark className="size-5" />
                Sign in with GitHub
              </Button>
            </form>
            <Button
              size="xl"
              variant="outline"
              render={<a href={DOCS_URL} />}
            >
              Read the docs
            </Button>
          </div>
        </section>
        <section
          aria-label="Features"
          className="mx-auto grid max-w-5xl gap-4 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map(({ title, body }) => (
            <Card key={title}>
              <CardHeader>
                <CardTitle render={<h2 />}>{title}</CardTitle>
                <CardDescription className="text-pretty">{body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
