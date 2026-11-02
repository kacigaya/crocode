import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { readStoredConfig } from "@/lib/config";
import { appSettingsUrl } from "@/lib/setup";

export const metadata: Metadata = { title: "Setup complete" };

export default function SetupDonePage() {
  const config = readStoredConfig();
  if (!config) notFound();
  const webUrl = (process.env.GITHUB_WEB_URL?.trim() || "https://github.com").replace(/\/$/, "");
  const settings = appSettingsUrl(webUrl, config);
  return (
    <>
      <SiteHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-lg px-6 pt-16 pb-20"
      >
        <h1 className="text-3xl font-semibold text-balance">
          Your GitHub App is ready
        </h1>
        <p className="mt-3 text-pretty text-muted-foreground">
          CroCode saved the credentials. The API and worker start on their
          own. Finish with these steps.
        </p>
        <ol className="mt-8 grid list-decimal gap-6 pl-5">
          <li>
            <p className="font-medium">Install the app on your repositories.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start with one test repository. Each review uses your agent
              credits.
            </p>
            <Button
              className="mt-3"
              render={<a href={`${webUrl}/apps/${config.slug}/installations/new`} />}
            >
              Install {config.slug}
            </Button>
          </li>
          <li>
            <p className="font-medium">Add the logo.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              GitHub has no API for app logos. Download the logo, open the app
              settings, and use <strong>Upload a logo</strong>. Set the badge
              background color to <code className="font-mono">#0a0a0a</code>.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Image
                src="/crocode-app-logo.png"
                alt="CroCode app logo"
                width={48}
                height={48}
                className="rounded-lg border"
              />
              <Button
                variant="outline"
                render={<a href="/crocode-app-logo.png" download />}
              >
                Download logo
              </Button>
              <Button variant="outline" render={<a href={settings} />}>
                Open app settings
              </Button>
            </div>
          </li>
          <li>
            <p className="font-medium">Sign in.</p>
            <Button className="mt-3" variant="outline" render={<Link href="/" />}>
              Go to sign-in
            </Button>
          </li>
        </ol>
      </main>
    </>
  );
}
