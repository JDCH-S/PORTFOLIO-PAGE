import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { profile } from "@/content/content";
import { SITE_URL } from "@/lib/site";

const chakra = Chakra_Petch({
  variable: "--font-chakra",
  subsets: ["latin"],
  weight: ["500", "600"],
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = `${profile.name} — ${profile.role}`;

// The share image and the icons are files in this folder (opengraph-image.jpg + .alt.txt, favicon.ico,
// icon.png, apple-icon.png, made by scripts/meta/make_meta_images.py): Next adds their tags itself,
// and twitter:image inherits the Open Graph image.
export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title,
  description: profile.tagline,
  applicationName: profile.name,
  authors: [{ name: profile.name }],
  // (the canonical URL is set on the home page itself, not here: every route inherits the layout's metadata, and a
  // canonical of "/" here would point 404s and any later page at the home page)
  openGraph: {
    type: "website",
    siteName: profile.name,
    title,
    description: profile.tagline,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: profile.tagline,
  },
};

export const viewport: Viewport = {
  themeColor: "#04060f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${chakra.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
