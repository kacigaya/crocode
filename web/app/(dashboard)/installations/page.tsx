import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { getEnv } from "@/lib/env";
import type { Installation } from "@/lib/types";

export const metadata: Metadata = { title: "Installations" };

export default async function InstallationsPage() {
  const installations = await api<Installation[]>("/api/v1/installations");
  const installUrl = `https://github.com/apps/${getEnv().appSlug}/installations/new`;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Installations</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Accounts you can access on this Crocode server.
          </p>
        </div>
        <Button render={<a href={installUrl} />}>Install GitHub App</Button>
      </div>
      {installations.length === 0 ? (
        <section className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-lg font-medium">No installations yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Install the GitHub App on a personal account or organization. It
            will appear here after this server receives the installation.
          </p>
        </section>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {installations.map((installation) => (
            <li
              key={installation.id}
              className="flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div className="min-w-0">
                <Link
                  href={`/installations/${installation.id}`}
                  className="break-words font-semibold underline-offset-4 hover:underline"
                >
                  {installation.account_login}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">
                  {installation.account_type} ·{" "}
                  {installation.repository_selection === "all"
                    ? "All repositories"
                    : "Selected repositories"}{" "}
                  · {installation.settings.agent}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={
                    installation.suspended
                      ? "warning"
                      : installation.settings.enabled
                        ? "success"
                        : "secondary"
                  }
                >
                  {installation.suspended
                    ? "Suspended"
                    : installation.settings.enabled
                      ? "Enabled"
                      : "Disabled"}
                </Badge>
                <Badge variant="outline">
                  {installation.can_admin ? "Admin" : "Read only"}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
