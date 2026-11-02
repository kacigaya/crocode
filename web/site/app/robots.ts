import type { MetadataRoute } from "next";
import { DOCS_SITE_URL } from "@/lib/docs-site";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${DOCS_SITE_URL}/sitemap.xml` };
}
