import {
  Account,
  AppNav,
  MobileNav,
  type NavInstallation,
} from "@/components/app-nav";
import { Brand } from "@/components/brand";
import { api } from "@/lib/api";
import { getEnv } from "@/lib/env";
import type { Installation, User } from "@/lib/types";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, installations] = await Promise.all([
    api<User>("/api/v1/me"),
    api<Installation[]>("/api/v1/installations"),
  ]);
  const nav: NavInstallation[] = installations.map((i) => ({
    id: i.id,
    name: i.account_login,
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
          <div className="flex h-14 items-center px-4">
            <Brand href="/installations" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            <AppNav installations={nav} installUrl={installUrl} />
          </div>
          <div className="border-t p-3">
            <Account login={user.login} />
          </div>
        </aside>
      </div>
      <div className="min-w-0">
        <MobileNav
          installations={nav}
          installUrl={installUrl}
          login={user.login}
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
