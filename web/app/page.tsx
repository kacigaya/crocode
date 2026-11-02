import { FileSearch, Lock, Server } from "lucide-react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { GitHubMark } from "@/components/github-mark";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readSession } from "@/lib/auth";
import { signIn } from "./auth-actions";

const messages: Record<string, string> = {
  expired: "Your session has expired. Sign in again.",
  access_denied: "GitHub sign-in was cancelled. Sign in to continue.",
};

const features = [
  {
    icon: Lock,
    title: "Read-only agents",
    body: "Claude Code, Codex, or OpenCode run in a locked container with a read-only checkout and no GitHub token.",
  },
  {
    icon: FileSearch,
    title: "Checked findings",
    body: "CroCode drops findings outside the diff, removes duplicates, and posts inline comments with suggested fixes.",
  },
  {
    icon: Server,
    title: "Your infrastructure",
    body: "Self-host the API, workers, and dashboard with Docker Compose on ARM64 or AMD64.",
  },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string; error?: string }>;
}) {
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
              render={<a href="https://github.com/kacigaya/crocode#readme" />}
            >
              Read the docs
            </Button>
          </div>
        </section>
        <section
          aria-label="Features"
          className="mx-auto grid max-w-5xl gap-3 px-6 pb-20 sm:grid-cols-3"
        >
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-5">
              <Icon aria-hidden="true" className="size-5 text-brand" />
              <h2 className="mt-3 font-semibold">{title}</h2>
              <p className="mt-1.5 text-pretty text-sm text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </section>
      </main>
      <footer className="mx-auto max-w-5xl border-t px-6 py-8 text-xs text-muted-foreground">
        CroCode · Self-hosted GitHub code review · Apache 2.0
      </footer>
    </>
  );
}
