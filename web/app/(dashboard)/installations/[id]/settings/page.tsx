import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsForm } from "@/components/settings-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/lib/api";
import { validInstallationId } from "@/lib/format";
import type { Agents, Installation } from "@/lib/types";

export const metadata: Metadata = { title: "Installation settings" };

const errors: Record<string, string> = {
  forbidden: "Only an account owner or organization admin can change settings.",
  agent: "Select an available agent.",
  model: "Enter a model, or leave the field empty.",
  digest_url: "Enter a webhook URL to turn on the weekly security digest.",
  validation:
    "The API did not accept these settings. Check the agent, the model, and that the webhook URL uses https and a public host name.",
  api: "Cannot save settings. Check that the CroCode API is available, then try again.",
};

export default async function InstallationSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  if (!validInstallationId(id)) notFound();
  const [installation, agents] = await Promise.all([
    api<Installation>(`/api/v1/installations/${id}`),
    api<Agents>("/api/v1/agents"),
  ]);
  return (
    <div className="max-w-2xl space-y-4">
      {error && errors[error] && (
        <Alert variant="error" role="alert">
          <AlertDescription>{errors[error]}</AlertDescription>
        </Alert>
      )}
      {!error && saved === "1" && (
        <Alert variant="success" role="status">
          <AlertDescription>Settings saved.</AlertDescription>
        </Alert>
      )}
      <SettingsForm installation={installation} agents={agents} />
    </div>
  );
}
