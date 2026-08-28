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

export const metadata: Metadata = {
  title: "Signet — Admin Dashboard",
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
