import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto max-w-xl space-y-4 px-6 py-16"
    >
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        This page does not exist, or the requested resource is no longer
        available.
      </p>
      <Button render={<Link href="/installations" />}>
        Go to installations
      </Button>
    </main>
  );
}
