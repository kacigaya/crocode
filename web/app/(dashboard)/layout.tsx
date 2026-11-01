import { SiteHeader } from "@/components/site-header";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await api<User>("/api/v1/me");
  return (
    <>
      <SiteHeader login={user.login} />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6"
      >
        {children}
      </main>
    </>
  );
}
