"use client";

import { type IconNode, MorphIcon } from "morphicons/react";
import { useEffect, useId, useRef, useState } from "react";
import { Brand } from "@/components/brand";
import { GitHubMark } from "@/components/github-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DOCS_URL } from "@/lib/docs-site";

// Lucide's Menu and X as icon data (ISC), so morphicons can morph between them.
const menuIcon: IconNode = [
  ["path", { d: "M4 5h16" }],
  ["path", { d: "M4 12h16" }],
  ["path", { d: "M4 19h16" }],
];
const closeIcon: IconNode = [
  ["path", { d: "M18 6 6 18" }],
  ["path", { d: "m6 6 12 12" }],
];

export function SiteHeader({
  mobileMenu,
  showDocsLink = true,
}: {
  mobileMenu?: React.ReactNode;
  showDocsLink?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const bar = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !bar.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 h-[4.625rem] px-4 pt-4 sm:h-[4.375rem] md:h-auto">
        <div
          ref={bar}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
          }}
          className={cn(
            "mx-auto w-full max-w-6xl rounded-2xl border px-3 py-3 shadow-sm backdrop-blur-md sm:px-5",
            open ? "bg-background" : "bg-background/70",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <Brand href="/" />
            <nav aria-label="Primary" className="flex items-center gap-2">
              {mobileMenu && (
                <Button
                  ref={toggle}
                  variant="ghost"
                  size="icon-sm"
                  className="md:hidden"
                  aria-expanded={open}
                  aria-controls={panelId}
                  aria-label={open ? "Close menu" : "Open menu"}
                  onClick={() => setOpen((value) => !value)}
                >
                  <MorphIcon icon={open ? closeIcon : menuIcon} reducedMotion="user" />
                </Button>
              )}
              <ThemeToggle />
              {showDocsLink && (
                <Button variant="ghost" size="sm" render={<a href={DOCS_URL} />}>
                  Docs
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                aria-label="GitHub"
                className="max-sm:size-8 max-sm:px-0"
                render={<a href="https://github.com/kacigaya/crocode" />}
              >
                <GitHubMark className="size-4" />
                <span className="hidden sm:inline">GitHub</span>
              </Button>
            </nav>
          </div>
          {mobileMenu && (
            // The bar grows to hold the menu, the panel fades in, and each
            // link fades and slides down into place.
            <div
              id={panelId}
              inert={!open}
              className={cn(
                "grid overflow-hidden transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none md:hidden",
                open
                  ? "grid-rows-[1fr] translate-y-0 opacity-100"
                  : "pointer-events-none grid-rows-[0fr] -translate-y-2 opacity-0",
              )}
              onClick={(event) => {
                if (event.target instanceof Element && event.target.closest("a")) {
                  setOpen(false);
                }
              }}
            >
              <div className="min-h-0 overflow-hidden">
                <div
                  className={cn(
                    "max-h-[calc(100dvh-8rem)] overflow-y-auto pt-4 pb-1 [&_a]:transition [&_a]:duration-200 motion-reduce:[&_a]:transition-none",
                    open ? "[&_a]:translate-y-0 [&_a]:opacity-100" : "[&_a]:-translate-y-1 [&_a]:opacity-0",
                  )}
                >
                  {mobileMenu}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>
    </>
  );
}
