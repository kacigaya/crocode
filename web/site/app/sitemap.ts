import type { MetadataRoute } from "next";
import { DOCS_PAGES } from "@/lib/docs-nav";
import { canonicalDocUrl } from "@/lib/docs-site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return DOCS_PAGES.map((page) => ({ url: canonicalDocUrl(page.href) }));
}
