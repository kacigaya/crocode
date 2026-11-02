import { ArrowRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Monogram } from "@/components/brand";
import { PageHeader, StatGrid } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { getEnv } from "@/lib/env";
import type { Agents, Installation } from "@/lib/types";

export const metadata: Metadata = { title: "Installations" };

export default async function InstallationsPage() {
  const [installations, agents] = await Promise.all([
    api<Installation[]>("/api/v1/installations"),
    api<Agents>("/api/v1/agents"),
  ]);
  const installUrl = `https://github.com/apps/${getEnv().appSlug}/installations/new`;
  const enabled = installations.filter(
    (i) => i.settings.enabled && !i.suspended,
  ).length;
  const install = (
    <Button render={<a href={installUrl} />}>
      <Plus aria-hidden="true" />
      Install GitHub App
    </Button>
  );
  return (
    <>
      <PageHeader
        title="Installations"
        description="GitHub accounts that you can access on this CroCode server."
        actions={installations.length > 0 ? install : undefined}
      />
      {installations.length === 0 ? (
        <section className="rounded-xl border border-dashed px-6 py-14 text-center">
          <h2 className="text-lg font-semibold">No installations yet</h2>
          <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-muted-foreground">
            Install the GitHub App on a personal account or organization. It
            appears here after this server receives the installation event.
          </p>
          <div className="mt-6">{install}</div>
        </section>
      ) : (
        <>
          <StatGrid
            label="Summary"
            stats={[
              { label: "Installations", value: installations.length },
              { label: "Reviews on", value: enabled },
              {
                label: "Suspended",
                value: installations.filter((i) => i.suspended).length,
              },
              {
                label: "Default agent",
                value: (
                  <span className="font-mono text-xl">{agents.default}</span>
                ),
              },
            ]}
          />
          <section aria-labelledby="accounts-title" className="space-y-3">
            <h2 id="accounts-title" className="text-sm font-semibold">
              Accounts
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {installations.map((installation) => (
                <li
                  key={installation.id}
                  className="group relative flex flex-col gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20"
                >
                  <div className="flex items-start gap-3">
                    <Monogram name={installation.account_login} size="lg" />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">
                        <Link
                          href={`/installations/${installation.id}`}
                          className="rounded-sm after:absolute after:inset-0 after:rounded-xl"
                        >
                          {installation.account_login}
                        </Link>
                      </h3>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {installation.account_type} ·{" "}
                        {installation.repository_selection === "all"
                          ? "All repositories"
                          : "Selected repositories"}
                      </p>
                    </div>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                          ? "Reviews on"
                          : "Reviews off"}
                    </Badge>
                    <Badge variant="outline" className="font-mono">
                      {installation.settings.agent ?? agents.default}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {installation.can_admin ? "Admin" : "Read only"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
