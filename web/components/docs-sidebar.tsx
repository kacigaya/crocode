"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/lib/docs-nav";
import { cn } from "@/lib/utils";

export function DocsSidebar() {
  const pathname = usePathname().replace(/\/$/, "") || "/docs";

  return (
    <nav aria-label="Documentation" className="flex flex-col gap-6 text-sm">
      {DOCS_NAV.map((section) => (
        <div key={section.title}>
          <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section.title}
          </p>
          <ul className="flex flex-col gap-1">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 transition-colors",
                      active
                        ? "bg-accent font-medium text-brand"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
