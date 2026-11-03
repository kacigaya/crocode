import type { MetadataRoute } from "next";
import { DOCS_PAGES } from "@/lib/docs-nav";
import { canonicalDocUrl, DOCS_SITE_URL } from "@/lib/docs-site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${DOCS_SITE_URL}/` }, ...DOCS_PAGES.map((page) => ({ url: canonicalDocUrl(page.href) }))];
}
