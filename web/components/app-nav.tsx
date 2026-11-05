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
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  /** Icon rail mode: labels move to tooltips and stay readable by screen readers. */
  collapsed?: boolean;
};

const itemClass =
  "relative flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors before:absolute before:inset-y-1.5 before:-left-2 before:w-0.75 before:rounded-r-full hover:bg-accent hover:text-foreground aria-[current=page]:bg-sidebar-active aria-[current=page]:font-medium aria-[current=page]:text-sidebar-active-foreground aria-[current=page]:before:bg-brand";

const stateLabel = {
  enabled: "Reviews on",
  disabled: "Reviews off",
  suspended: "Suspended",
};

const stateDot = {
  enabled: "bg-success",
  disabled: "bg-neutral-400 dark:bg-neutral-500",
  suspended: "bg-warning",
};

/** Shows the item label in a tooltip when the sidebar is an icon rail. */
function NavTooltip({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: React.ReactElement;
}) {
  if (!collapsed) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function AppNav({
  installations,
  installUrl,
  onNavigate,
  collapsed = false,
}: NavProps) {
  const pathname = usePathname().replace(/\/$/, "");
  const item = cn(itemClass, collapsed && "justify-center px-0");
  const label = collapsed ? "sr-only" : "min-w-0 flex-1 truncate";
  return (
    <nav aria-label="Dashboard" className="space-y-6">
      <ul className="space-y-0.5">
        <li>
          <NavTooltip label="Overview" collapsed={collapsed}>
            <Link
              href="/installations"
              onClick={onNavigate}
              aria-current={pathname === "/installations" ? "page" : undefined}
              className={item}
            >
              <LayoutGrid aria-hidden="true" className="size-4 shrink-0" />
              <span className={label}>Overview</span>
            </Link>
          </NavTooltip>
        </li>
      </ul>
      <div>
        <h2
          className={
            collapsed
              ? "sr-only"
              : "px-2 pb-1.5 text-xs font-medium text-muted-foreground"
          }
        >
          Installations
        </h2>
        <ul className="space-y-0.5">
          {installations.map((installation) => {
            const href = `/installations/${installation.id}`;
            const state = stateLabel[installation.state];
            const dot = cn("rounded-full", stateDot[installation.state]);
            return (
              <li key={installation.id}>
                <NavTooltip
                  label={`${installation.name} · ${state}`}
                  collapsed={collapsed}
                >
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={pathname === href ? "page" : undefined}
                    className={item}
                  >
                    <span className="relative shrink-0">
                      <Avatar
                        name={installation.name}
                        image={installation.image}
                      />
                      {collapsed && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            dot,
                            "absolute -right-1 -bottom-1 size-2.5 ring-2 ring-sidebar",
                          )}
                        />
                      )}
                    </span>
                    <span className={label}>{installation.name}</span>
                    {!collapsed && (
                      <span
                        aria-hidden="true"
                        title={state}
                        className={cn(dot, "size-1.5 shrink-0")}
                      />
                    )}
                    <span className="sr-only">, {state}</span>
                  </Link>
                </NavTooltip>
              </li>
            );
          })}
          <li>
            <NavTooltip label="Add installation" collapsed={collapsed}>
              <a href={installUrl} onClick={onNavigate} className={item}>
                <Plus aria-hidden="true" className="size-4 shrink-0" />
                <span className={label}>Add installation</span>
              </a>
            </NavTooltip>
          </li>
        </ul>
      </div>
      <ul className="space-y-0.5">
        <li>
          <NavTooltip label="Documentation" collapsed={collapsed}>
            <a href={DOCS_URL} onClick={onNavigate} className={item}>
              <BookOpen aria-hidden="true" className="size-4 shrink-0" />
              <span className={label}>Documentation</span>
            </a>
          </NavTooltip>
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

export function Account({
  login,
  name,
  image,
  compact,
}: Profile & { compact?: boolean }) {
  const displayName = name?.trim() || login;
  return (
    <div
      className={cn(
        "flex items-center gap-2.5",
        compact && "flex-col gap-2",
      )}
    >
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
      <div className={compact ? "sr-only" : "min-w-0 flex-1 leading-tight"}>
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
        <NavTooltip label="Sign out" collapsed={compact ?? false}>
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            aria-label="Sign out"
          >
            <LogOut aria-hidden="true" />
          </Button>
        </NavTooltip>
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
