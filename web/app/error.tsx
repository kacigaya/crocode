"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto max-w-xl space-y-4 px-6 py-16"
    >
      <h1 className="text-2xl font-semibold">Cannot load this page</h1>
      <p className="text-sm text-muted-foreground">
        The CroCode API may be unavailable, or your account may not have access.
        Try again or return to your installations.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" render={<Link href="/installations" />}>
          Installations
        </Button>
      </div>
    </main>
  );
}
