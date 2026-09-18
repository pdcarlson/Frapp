import "./globals.css";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { PageviewTracker } from "../components/pageview-tracker";

/*
 * Figtree is the Signet typeface (brand-identity.md §3 — Geist is explicitly
 * rejected). Variable file, 400–700: the locked weights are 400/600/700 and
 * foundations.md §7 allows no others. Same vendored file `apps/web` loads.
 */
const figtree = localFont({
  src: "../../../packages/theme/fonts/FigtreeVF.woff2",
  variable: "--font-figtree",
  weight: "400 700",
  display: "swap",
});

const ogDescription =
  "One platform for chat, events, study hours, points, backwork, and billing.";

export const metadata: Metadata = {
  title: "Signet. Ask your chapter anything.",
  description:
    "Replace Discord, OmegaFi, and Life360 with one app. Chat, events, study hours, points, and billing for fraternity chapters.",
  metadataBase: new URL("https://frapp.live"),
  openGraph: {
    title: "Signet. Ask your chapter anything.",
    description: ogDescription,
    type: "website",
    url: "https://frapp.live",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Signet. Ask your chapter anything.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Signet. Ask your chapter anything.",
    description: ogDescription,
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={figtree.variable}>
      <body className="font-sans antialiased">
        <PageviewTracker />
        {children}
      </body>
    </html>
  );
}
