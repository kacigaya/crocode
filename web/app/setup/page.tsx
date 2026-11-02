import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SetupForm } from "@/components/setup-form";
import { SiteHeader } from "@/components/site-header";
import { readStoredConfig, setupAvailable, setupToken } from "@/lib/config";
import { defaultAppName, parseOrigin } from "@/lib/setup";

export const metadata: Metadata = { title: "Set up" };

/** Best guess of the public address from the request a proxy forwarded. */
async function requestOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http";
  return (host && parseOrigin(`${proto}://${host}`)) || "";
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (readStoredConfig()) redirect("/setup/done");
  if (!setupAvailable()) notFound();
  // Creates the token if startup logging did not run yet.
  setupToken();
  const { token } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-lg px-6 pt-16 pb-20"
      >
        <h1 className="text-3xl font-semibold text-balance">Set up CroCode</h1>
        <p className="mt-3 text-pretty text-muted-foreground">
          CroCode creates its GitHub App for you. GitHub asks you to confirm,
          then sends you back here. The API and worker start when the app
          exists.
        </p>
        <SetupForm
          defaults={{
            token: typeof token === "string" ? token : "",
            url: await requestOrigin(),
            name: defaultAppName(),
            owner: "",
          }}
        />
      </main>
    </>
  );
}
