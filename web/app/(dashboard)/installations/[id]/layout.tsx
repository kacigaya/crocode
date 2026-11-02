import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/brand";
import { PageHeader } from "@/components/page-header";
import { SectionNav } from "@/components/section-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { accountAvatar } from "@/lib/avatar";
import { validInstallationId } from "@/lib/format";
import type { Installation } from "@/lib/types";

export default async function InstallationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!validInstallationId(id)) notFound();
  const installation = await api<Installation>(`/api/v1/installations/${id}`);
  const githubUrl =
    installation.account_type === "Organization"
      ? `https://github.com/organizations/${encodeURIComponent(installation.account_login)}/settings/installations/${installation.id}`
      : `https://github.com/settings/installations/${installation.id}`;
  const base = `/installations/${installation.id}`;
  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Installations", href: "/installations" },
          { label: installation.account_login },
        ]}
        leading={
          <Avatar
            name={installation.account_login}
            image={accountAvatar(installation.account_id)}
            size="lg"
          />
        }
        title={installation.account_login}
        description={
          <>
            {installation.account_type} ·{" "}
            {installation.repository_selection === "all"
              ? "All repositories"
              : "Selected repositories"}{" "}
            · Installation{" "}
            <span className="font-mono tabular-nums">{installation.id}</span>
          </>
        }
        meta={
          <>
            {installation.suspended ? (
              <Badge variant="warning">Suspended on GitHub</Badge>
            ) : (
              <Badge
                variant={
                  installation.settings.enabled ? "success" : "secondary"
                }
              >
                {installation.settings.enabled ? "Reviews on" : "Reviews off"}
              </Badge>
            )}
            <Badge variant="outline">
              {installation.can_admin ? "Admin" : "Read only"}
            </Badge>
          </>
        }
        actions={
          <Button variant="outline" render={<a href={githubUrl} />}>
            Manage on GitHub
            <ExternalLink aria-hidden="true" />
          </Button>
        }
      />
      <SectionNav
        label="Installation"
        links={[
          { href: base, label: "Overview" },
          { href: `${base}/vulnerabilities`, label: "Vulnerabilities" },
          { href: `${base}/settings`, label: "Settings" },
        ]}
      />
      {children}
    </>
  );
}
