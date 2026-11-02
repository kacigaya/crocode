import {
  Account,
  AppNav,
  MobileNav,
  type NavInstallation,
} from "@/components/app-nav";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/api";
import { accountAvatar } from "@/lib/avatar";
import { readSession } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import type { Installation, User } from "@/lib/types";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, installations, session] = await Promise.all([
    api<User>("/api/v1/me"),
    api<Installation[]>("/api/v1/installations"),
    readSession(),
  ]);
  // GitHub sign-in stores the display name and avatar in the session cookie.
  const profile = {
    login: user.login,
    name: session?.user.name,
    image: session?.user.image,
  };
  const nav: NavInstallation[] = installations.map((i) => ({
    id: i.id,
    name: i.account_login,
    image: accountAvatar(i.account_id),
    state: i.suspended
      ? "suspended"
      : i.settings.enabled
        ? "enabled"
        : "disabled",
  }));
  const installUrl = `https://github.com/apps/${getEnv().appSlug}/installations/new`;
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="hidden border-r bg-sidebar md:block">
        <aside className="sticky top-0 flex h-dvh flex-col">
          <div className="flex h-14 items-center justify-between px-4">
            <Brand href="/installations" />
            <ThemeToggle />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            <AppNav installations={nav} installUrl={installUrl} />
          </div>
          <div className="border-t p-3">
            <Account {...profile} />
          </div>
        </aside>
      </div>
      <div className="min-w-0">
        <MobileNav
          installations={nav}
          installUrl={installUrl}
          {...profile}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 sm:px-8 sm:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
