import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { readSession } from "@/lib/auth";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string }>;
}) {
  if (await readSession()) redirect("/installations");
  const { auth } = await searchParams;
  const messages: Record<string, string> = {
    state: "This sign-in request expired or could not be verified. Try again.",
    denied: "GitHub sign-in was cancelled. Sign in to continue.",
    exchange: "GitHub sign-in could not finish. Try again.",
  };
  return (
    <>
      <SiteHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-3xl px-6 py-20 text-center sm:py-28"
      >
        <p className="mb-5 font-mono text-sm text-muted-foreground">
          GitHub pull requests / AI code review
        </p>
        <h1 className="text-balance text-4xl font-semibold sm:text-5xl">
          Your code. Your review bot.
          <br />
          Your infrastructure.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground">
          Crocode reviews GitHub pull requests with the agent you choose. Manage
          installations, set review defaults, and inspect findings from one
          dashboard.
        </p>
        {auth && messages[auth] && (
          <p role="alert" className="mt-6 rounded-lg border p-4 text-sm">
            {messages[auth]}
          </p>
        )}
        <Button
          size="xl"
          className="mt-8"
          render={<a href="/api/auth/login" />}
        >
          Sign in with GitHub
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">
          Open source. Self-hostable. Apache 2.0.
        </p>
      </main>
    </>
  );
}
