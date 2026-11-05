"use client";

import { useEffect, useId, useState } from "react";
import {
  Account,
  AppNav,
  type NavInstallation,
  type Profile,
} from "@/components/app-nav";
import { Brand } from "@/components/brand";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Desktop sidebar. Collapses to an icon rail with the toggle or Ctrl/⌘+B. */
export function DashboardSidebar({
  defaultCollapsed,
  installations,
  installUrl,
  profile,
}: {
  defaultCollapsed: boolean;
  installations: NavInstallation[];
  installUrl: string;
  profile: Profile;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const id = useId();

  useEffect(() => {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? SIDEBAR_COLLAPSED : "expanded"}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
  }, [collapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "b" ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        isEditable(event.target)
      ) {
        return;
      }
      event.preventDefault();
      setCollapsed((value) => !value);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className={cn(
        "hidden border-r bg-sidebar transition-[width] duration-200 ease-out motion-reduce:transition-none md:block",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <TooltipProvider>
        <aside id={id} className="sticky top-0 flex h-dvh flex-col">
          <div
            className={cn(
              "flex shrink-0 items-center",
              collapsed
                ? "flex-col gap-2 py-3"
                : "h-14 justify-between gap-1 pr-2 pl-4",
            )}
          >
            <Brand href="/installations" compact={collapsed} />
            <div className={cn("flex items-center", collapsed && "flex-col")}>
              <ThemeToggle />
              <SidebarToggle
                collapsed={collapsed}
                controls={id}
                onToggle={() => setCollapsed((value) => !value)}
              />
            </div>
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3",
              collapsed && "border-t",
            )}
          >
            <AppNav
              installations={installations}
              installUrl={installUrl}
              collapsed={collapsed}
            />
          </div>
          <div className={cn("border-t", collapsed ? "py-3" : "p-3")}>
            <Account {...profile} compact={collapsed} />
          </div>
        </aside>
      </TooltipProvider>
    </div>
  );
}
