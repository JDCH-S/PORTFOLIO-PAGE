import type { Metadata } from "next";
import Site from "@/components/site/Site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return <Site />;
}
