import Link from "next/link";
import { isDocsSite } from "@/lib/docs-site";

const GITHUB_URL = "https://github.com/kacigaya/crocode";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
        <span>© {new Date().getFullYear()} CroCode</span>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          <Link href="/docs" className="hover:text-foreground">Documentation</Link>
          <a href={GITHUB_URL} className="hover:text-foreground">GitHub</a>
          <a href={`${GITHUB_URL}/blob/main/LICENSE`} className="hover:text-foreground">Apache 2.0</a>
          {isDocsSite() && <Link href="/privacy" className="hover:text-foreground">Privacy</Link>}
        </nav>
      </div>
    </footer>
  );
}
