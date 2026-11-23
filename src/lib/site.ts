/**
 * The site's public origin, for metadataBase, robots.txt and the sitemap (they need absolute URLs).
 *
 * 1. NEXT_PUBLIC_SITE_URL, when set (e.g. https://example.com): pins it explicitly.
 * 2. On Vercel, VERCEL_PROJECT_PRODUCTION_URL (a system env var, on by default): the project's
 *    production domain, i.e. <project>.vercel.app before a custom domain is added and the custom
 *    domain after it (from the next deployment on), with no change here.
 * 3. Otherwise localhost (`next dev` / `next start` on this machine).
 *
 * Read at build time: the pages that use it are prerendered.
 */
function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return new URL(explicit.includes("://") ? explicit : `https://${explicit}`);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL(`http://localhost:${process.env.PORT || 3000}`);
}

export const SITE_URL = siteUrl();
