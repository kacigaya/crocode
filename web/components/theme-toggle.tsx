"use client";

import { Moon, Sun } from "lucide-react";
import { type IconNode, MorphIcon } from "morphicons/react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { DARK_QUERY, THEME_KEY } from "@/lib/theme";

// Lucide's Sun and Moon as icon data (ISC), the input morphicons expects.
// lucide-react only exports them as components.
const sunIcon: IconNode = [
  ["circle", { cx: "12", cy: "12", r: "4" }],
  ["path", { d: "M12 2v2" }],
  ["path", { d: "M12 20v2" }],
  ["path", { d: "m4.93 4.93 1.41 1.41" }],
  ["path", { d: "m17.66 17.66 1.41 1.41" }],
  ["path", { d: "M2 12h2" }],
  ["path", { d: "M20 12h2" }],
  ["path", { d: "m6.34 17.66-1.41 1.41" }],
  ["path", { d: "m19.07 4.93-1.41 1.41" }],
];
const moonIcon: IconNode = [
  [
    "path",
    {
      d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401",
    },
  ],
];

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  // Follow OS changes until the user picks a theme.
  const media = matchMedia(DARK_QUERY);
  const onMedia = () => {
    if (!localStorage.getItem(THEME_KEY))
      document.documentElement.classList.toggle("dark", media.matches);
  };
  media.addEventListener("change", onMedia);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onMedia);
  };
}

const isDark = () => document.documentElement.classList.contains("dark");

/** The active theme. null on the server: it is only known in the browser. */
export function useIsDark() {
  return useSyncExternalStore<boolean | null>(subscribe, isDark, () => null);
}

export function ThemeToggle() {
  const dark = useIsDark();

  function toggle() {
    const next = !isDark();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // Private mode can block storage. The switch still works for this page.
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={
        dark === null
          ? "Toggle dark mode"
          : dark
            ? "Switch to light mode"
            : "Switch to dark mode"
      }
    >
      {dark === null ? (
        // Before hydration, CSS picks the icon so it never flashes.
        <>
          <Sun aria-hidden="true" className="dark:hidden" />
          <Moon aria-hidden="true" className="hidden dark:block" />
        </>
      ) : (
        <MorphIcon icon={dark ? moonIcon : sunIcon} reducedMotion="user" />
      )}
    </Button>
  );
}
