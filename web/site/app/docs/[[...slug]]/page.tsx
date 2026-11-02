import { DOCS_PAGES } from "@/lib/docs-nav";

export { default, generateMetadata } from "@/app/docs/[[...slug]]/page";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS_PAGES.map((page) => ({
    slug: page.href.replace(/^\/docs\/?/, "").split("/").filter(Boolean),
  }));
}
