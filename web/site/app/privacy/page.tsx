import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { DOCS_SITE_URL } from "@/lib/docs-site";
import "./legal.css";

const UPDATED = "2026-11-19";
const CONTACT = "contact@gaya.anonaddy.com";
const DESCRIPTION = "How the CroCode website handles data, hosting requests, and your privacy.";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: DESCRIPTION,
  alternates: { canonical: `${DOCS_SITE_URL}/privacy/` },
  openGraph: { type: "website", url: `${DOCS_SITE_URL}/privacy/`, title: "Privacy policy · CroCode", description: DESCRIPTION },
};

export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className="prose-legal mx-auto w-full max-w-3xl flex-1 px-6 py-12 text-sm text-foreground sm:py-16"
      >
        <h1>Privacy policy</h1>
        <p className="text-xs text-muted-foreground tabular-nums">
          Last updated <time dateTime={UPDATED}>19 November 2026</time>
        </p>
        <h2>About this site</h2>
        <p>
          This policy covers the CroCode website and documentation. It does not cover a CroCode instance that
          you run yourself, its dashboard, or the GitHub and model provider services you connect it to. The site
          has no accounts, advertising, audience analytics, or tracking scripts. We do not sell visitor data or
          use it for marketing.
        </p>
        <h2>Who is responsible</h2>
        <p>
          Gaya KACI operates this site. For privacy questions or requests, email{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
        <h2>Hosting and request logs</h2>
        <p>
          This site is published with GitHub Pages. Serving a page requires GitHub to process your IP address
          and request details under its own privacy statement.
        </p>
        <p>
          GitHub controls its hosting logs, retention, and infrastructure. I do not receive or control those
          logs. See GitHub’s{" "}
          <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">
            privacy statement
          </a>{" "}
          for details.
        </p>
        <h2>Browser storage</h2>
        <p>
          The site sets no cookies. When you change the theme, the site saves your choice in local storage under{" "}
          <code>crocode-theme</code>. This is a browser preference, not a visitor identifier, and the site does
          not send it anywhere. Clear it with your browser’s site-data controls.
        </p>
        <h2>Contact and external links</h2>
        <p>
          If you email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>, addy.io forwards the message to the
          operator’s mailbox. Those mail services process the message to deliver it. Correspondence is kept
          while needed to answer your request; you can ask for deletion.
        </p>
        <p>
          External links take you to independently operated services under their own policies. Fonts and site
          assets are served with the site; there are no embedded advertising or analytics widgets.
        </p>
        <h2>Your rights</h2>
        <p>
          Where the GDPR applies, you can request access, correction, erasure, restriction, or portability where
          applicable, and object to processing based on legitimate interests. Operating and securing the site and
          answering correspondence rely on those legitimate interests. Email the operator to exercise these
          rights. We normally respond within one month. You can also complain to your data protection authority,
          including the <a href="https://www.cnil.fr/">CNIL</a> in France.
        </p>
        <p>
          Browser-only preferences are not available to the operator. For those, use your browser’s site-data
          controls.
        </p>
        <h2>Changes</h2>
        <p>
          This page will be updated when the site’s data handling changes. The date above identifies the latest
          revision.
        </p>
        <p>
          <Link href="/">Back to CroCode</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
