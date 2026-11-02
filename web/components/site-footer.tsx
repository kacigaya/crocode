import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-6xl flex-col gap-3 border-t px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>CroCode · Self-hosted GitHub code review</p>
      <nav aria-label="Footer" className="flex gap-5">
        <Link href="/docs" className="hover:text-foreground">Documentation</Link>
        <a href="https://github.com/kacigaya/crocode/blob/main/LICENSE" className="hover:text-foreground">Apache 2.0</a>
      </nav>
    </footer>
  );
}
