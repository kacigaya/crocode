import DocsNotFound from "@/app/docs/not-found";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader showDocsLink={false} />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <DocsNotFound />
      </main>
      <SiteFooter />
    </div>
  );
}
