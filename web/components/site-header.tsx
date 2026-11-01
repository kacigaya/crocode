import Link from "next/link";
import { Button } from "@/components/ui/button";

export function SiteHeader({ login }: { login?: string }) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 px-4 pt-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-2xl border bg-background/95 px-5 py-3 shadow-sm backdrop-blur-md">
          <Link
            href={login ? "/installations" : "/"}
            className="font-mono text-lg font-semibold"
          >
            crocode
            <span aria-hidden="true" className="text-muted-foreground">
              _
            </span>
          </Link>
          {login ? (
            <nav
              aria-label="Account"
              className="flex min-w-0 items-center gap-3"
            >
              <span
                className="max-w-40 truncate text-sm text-muted-foreground"
                title={login}
              >
                @{login}
              </span>
              <form action="/api/auth/logout" method="post">
                <Button type="submit" variant="outline">
                  Sign out
                </Button>
              </form>
            </nav>
          ) : (
            <span className="text-xs text-muted-foreground">
              Apache 2.0 · self-hosted
            </span>
          )}
        </div>
      </header>
    </>
  );
}
