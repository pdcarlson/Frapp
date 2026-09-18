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

/*
 * The DESCRIPTIONS follow the page body's positioning; the TITLES do not move.
 *
 * Both sentences used to sell the ops-consolidation page that #2367 deleted:
 * one named Discord, OmegaFi and Life360, the other listed six modules side by
 * side. Marketing copy rules reach the meta description
 * (`spec/ui/landing/README.md` § Marketing copy rules), so leaving them would
 * have left the page's only surviving "operating system for Greek Life" claim
 * in the tag search engines and link previews read. They now match the hero
 * lead, which is what the Spec sheet's copy deck asks for.
 *
 * The titles keep "Signet. Ask your chapter anything." deliberately. D8 holds
 * that tagline off the page BODY until Ask can answer, and scopes itself to the
 * body: `spec/ui/brand-identity.md` §1 still locks it as the brand tagline, and
 * a brand tagline in a title tag is not a product claim about a shipped
 * control. The page body closes on "Everything your chapter needs is already in
 * chat." instead.
 */
const ogDescription =
  "Signet is chat first. Events, check-in and points land in the conversation your chapter already reads.";

export const metadata: Metadata = {
  title: "Signet. Ask your chapter anything.",
  description:
    "Signet is chat first. Events, check-in and points land in the conversation your members already read. Free for chat and members, with no card.",
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
