"use client";

import { BookOpen, LayoutGrid, LogOut, Menu, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState } from "react";
import { signOut } from "@/app/auth-actions";
import { Brand, Monogram } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DOCS_URL } from "@/lib/docs-site";

export type NavInstallation = {
  id: number;
  name: string;
  state: "enabled" | "disabled" | "suspended";
};

type NavProps = {
  installations: NavInstallation[];
  installUrl: string;
  onNavigate?: () => void;
};

const itemClass =
  "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground";

const stateLabel = {
  enabled: "Reviews on",
  disabled: "Reviews off",
  suspended: "Suspended",
};

export function AppNav({ installations, installUrl, onNavigate }: NavProps) {
  const pathname = usePathname().replace(/\/$/, "");
  return (
    <nav aria-label="Dashboard" className="space-y-6">
      <ul className="space-y-0.5">
        <li>
          <Link
            href="/installations"
            onClick={onNavigate}
            aria-current={pathname === "/installations" ? "page" : undefined}
            className={itemClass}
          >
            <LayoutGrid aria-hidden="true" className="size-4" />
            Overview
          </Link>
        </li>
      </ul>
      <div>
        <h2 className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">
          Installations
        </h2>
        <ul className="space-y-0.5">
          {installations.map((installation) => {
            const href = `/installations/${installation.id}`;
            return (
              <li key={installation.id}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={pathname === href ? "page" : undefined}
                  className={itemClass}
                >
                  <Monogram name={installation.name} />
                  <span className="min-w-0 flex-1 truncate">
                    {installation.name}
                  </span>
                  <span
                    aria-hidden="true"
                    title={stateLabel[installation.state]}
                    className={cn(
                      "size-1.5 rounded-full",
                      installation.state === "enabled" && "bg-success",
                      installation.state === "disabled" &&
                        "bg-muted-foreground/40",
                      installation.state === "suspended" && "bg-warning",
                    )}
                  />
                  <span className="sr-only">
                    , {stateLabel[installation.state]}
                  </span>
                </Link>
              </li>
            );
          })}
          <li>
            <a href={installUrl} onClick={onNavigate} className={itemClass}>
              <Plus aria-hidden="true" className="size-4" />
              Add installation
            </a>
          </li>
        </ul>
      </div>
      <ul className="space-y-0.5">
        <li>
          <a
            href={DOCS_URL}
            onClick={onNavigate}
            className={itemClass}
          >
            <BookOpen aria-hidden="true" className="size-4" />
            Documentation
          </a>
        </li>
      </ul>
    </nav>
  );
}

export function Account({ login }: { login: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Monogram name={login} />
      <span className="min-w-0 flex-1 truncate text-sm" title={login}>
        @{login}
      </span>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
          <LogOut aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}

/** Top bar with a menu panel, shown below the md breakpoint. */
export function MobileNav(props: NavProps & { login: string }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  function close() {
    setOpen(false);
  }
  return (
    <header
      className="sticky top-0 z-20 border-b bg-background md:hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          close();
          toggle.current?.focus();
        }
      }}
    >
      <div className="flex h-14 items-center justify-between px-4">
        <Brand href="/installations" />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button
            ref={toggle}
            type="button"
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <div
        id={panelId}
        hidden={!open}
        className="max-h-[calc(100dvh-3.5rem)] space-y-6 overflow-y-auto border-t px-3 py-4"
      >
        <AppNav {...props} onNavigate={close} />
        <div className="border-t px-2 pt-4">
          <Account login={props.login} />
        </div>
      </div>
    </header>
  );
}
