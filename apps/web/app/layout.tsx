import "./globals.css";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppProviders } from "./providers";
import { OfflineBanner } from "@/components/shared/offline-banner";
import { Toaster } from "@/components/ui/toaster";

/*
 * Figtree is the Signet typeface (brand-identity.md §3 — Geist is explicitly
 * rejected). Variable file, 400–700: the locked weights are 400/600/700 and
 * foundations.md §7 allows no others.
 */
const figtree = localFont({
  src: "../../../packages/theme/fonts/FigtreeVF.woff2",
  variable: "--font-figtree",
  weight: "400 700",
  display: "swap",
});

/*
 * One title template, so no route spells the product name itself.
 *
 * Seventeen routes carried `"<Page> — Signet"` as a literal, which is two
 * defects in one string. The em dash breaks the greenfield's no-em-dash lock
 * (`spec/ui/web-greenfield/README.md` §2) on copy a member reads in the tab
 * strip; `·` is the separator the framework board uses throughout its own
 * chrome ("Start a chapter · 1 of 3", "$3 per member / month · 42 members").
 * And seventeen copies of a brand name is seventeen places for it to drift —
 * `/no-access` shipped the *previous* product name in its title until the #920
 * slice corrected that one by hand, which is the whole argument for spelling it
 * once. `scripts/ci/__tests__/signet-web-titles.test.mjs` bans that name from
 * this file outright, comments included, so it is described here rather than
 * quoted.
 *
 * The default was `"Signet Admin Dashboard"`. It is the only string in the
 * product that calls this surface an admin dashboard, and it is wrong on the
 * greenfield: `nav-config.ts` gates Admin behind a permission and everything
 * above it — Chat, Events, Tasks, Points, Polls, Directory — is a member
 * surface. The pre-auth screens already render the product as plain "Signet"
 * (`page.tsx`, `sign-in/page.tsx`), so the default now agrees with them.
 */
export const metadata: Metadata = {
  title: {
    default: "Signet",
    template: "%s · Signet",
  },
  description: "Ask your chapter anything.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={figtree.variable}>
      <body className="font-sans antialiased">
        <AppProviders>
          <OfflineBanner />
          {children}
          <Toaster />
        </AppProviders>
      </body>
    </html>
  );
}
