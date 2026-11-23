import type { Metadata } from "next";
import Link from "next/link";
import Brackets from "@/components/hud/Brackets";
import { profile } from "@/content/content";

export const metadata: Metadata = {
  title: `Not found — ${profile.name}`,
};

/** The 404 in the site's colours (the framework's default is black on white). */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg px-4 text-center">
      <p className="label text-steel">404 · signal lost</p>
      <h1 className="font-display text-[26px] leading-[30px] font-semibold tracking-[0.06em] text-gold-hot">NOTHING HERE</h1>
      <Link href="/" className="label relative mt-2 inline-flex min-h-10 items-center px-4 text-gold transition-colors hover:text-gold-hot focus-visible:text-gold-hot">
        <Brackets size={8} />
        Back to the core
      </Link>
    </main>
  );
}
