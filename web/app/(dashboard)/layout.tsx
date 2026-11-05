import { cookies } from "next/headers";
import { MobileNav, type NavInstallation } from "@/components/app-nav";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { api } from "@/lib/api";
import { accountAvatar } from "@/lib/avatar";
import { readSession } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "@/lib/sidebar";
import type { Installation, User } from "@/lib/types";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, installations, session, cookieStore] = await Promise.all([
    api<User>("/api/v1/me"),
    api<Installation[]>("/api/v1/installations"),
    readSession(),
    cookies(),
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
    <div className="min-h-dvh md:grid md:grid-cols-[auto_minmax(0,1fr)]">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <DashboardSidebar
        defaultCollapsed={
          cookieStore.get(SIDEBAR_COOKIE)?.value === SIDEBAR_COLLAPSED
        }
        installations={nav}
        installUrl={installUrl}
        profile={profile}
      />
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
