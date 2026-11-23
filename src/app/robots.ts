import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Everything is allowed. /sphere (the hologram's developer page) keeps itself out of search on its own: a 404
    // without a tooling flag, noindex with one, and crawlers must be let in to see that. A "Disallow: /sphere" rule
    // would also block /sphere-static*.webp (robots rules match by prefix), the hero's poster.
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", SITE_URL).href,
  };
}
