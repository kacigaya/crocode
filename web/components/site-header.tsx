import { Brand } from "@/components/brand";
import { GitHubMark } from "@/components/github-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 px-4 pt-4">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between rounded-2xl border bg-background/70 px-5 py-3 shadow-sm backdrop-blur-md">
          <Brand href="/" />
          <nav aria-label="Primary" className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              render={<a href="https://github.com/kacigaya/crocode" />}
            >
              <GitHubMark className="size-4" />
              GitHub
            </Button>
          </nav>
        </div>
      </header>
    </>
  );
}
