"use client";

import { BookOpen, LayoutGrid, LogOut, Menu, Plus, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState } from "react";
import { signOut } from "@/app/auth-actions";
import { Avatar, Brand, Monogram } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { AVATAR_PREFIX } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { DOCS_URL } from "@/lib/docs-site";

export type NavInstallation = {
  id: number;
  name: string;
  image: string | null;
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
                  <Avatar name={installation.name} image={installation.image} />
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

/** The signed-in GitHub user, from the Better Auth session. */
export type Profile = {
  login: string;
  name?: string | null;
  image?: string | null;
};

export function Account({ login, name, image }: Profile) {
  const displayName = name?.trim() || login;
  return (
    <div className="flex items-center gap-2.5">
      {image?.startsWith(AVATAR_PREFIX) ? (
        <Image
          src={image}
          alt=""
          width={32}
          height={32}
          className="size-8 shrink-0 rounded-full border"
        />
      ) : (
        <Monogram name={login} />
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-medium" title={displayName}>
          {displayName}
        </p>
        {displayName !== login && (
          <p className="truncate text-xs text-muted-foreground" title={login}>
            @{login}
          </p>
        )}
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
          <LogOut aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}

/** Top bar with a menu panel, shown below the md breakpoint. */
export function MobileNav(props: NavProps & Profile) {
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
          <Account login={props.login} name={props.name} image={props.image} />
        </div>
      </div>
    </header>
  );
}
