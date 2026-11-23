import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SphereStage from "@/components/sphere/SphereStage";

// no title of its own: when the page 404s that metadata can still reach the tab (mobile streams it)
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** The query flags the tooling opens this page with (README): any one of them unlocks it. */
const FLAGS = ["debug", "capture", "freeze", "tier", "t"];

/**
 * Developer page: the face hologram alone with the tweak panel. Not for visitors: without one of the
 * flags above (or a `holo.*` override) it is a 404, so /sphere is neither linked nor reachable by
 * chance; with one it is noindex (and robots.txt disallows it). Reading searchParams renders it per
 * request, which costs nothing here: the page is a client shell.
 */
export default async function SpherePage({ searchParams }: PageProps<"/sphere">) {
  const keys = Object.keys(await searchParams);
  if (!keys.some((k) => FLAGS.includes(k) || k.startsWith("holo."))) notFound();
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      <SphereStage debug spin />
    </main>
  );
}
