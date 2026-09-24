import { profile } from "@/content/content";
import Decode from "@/components/ui/Decode";

/**
 * Server-rendered stand-in for the header: the name and role are on screen before any
 * JavaScript runs, in the same place and size the real layouts put them.
 */
export default function BootHeader() {
  return (
    <header
      className="pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-[calc(12px+env(safe-area-inset-top,0px))] opacity-35 lg:px-5 lg:pt-5 xl:px-7 xl:pt-7"
    >
      <Decode as="h1" text={profile.name.toUpperCase()} active={false} className="truncate font-display text-[17px] leading-[22px] font-semibold tracking-[0.06em] text-gold-hot lg:text-[26px] lg:leading-[30px]" />
      <p className="label truncate text-steel">{profile.role}</p>
    </header>
  );
}
