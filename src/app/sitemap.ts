import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** A single page: the sections and items are hash routes (#projects/prj-01) of the home page. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: new URL("/", SITE_URL).href, changeFrequency: "monthly", priority: 1 }];
}
