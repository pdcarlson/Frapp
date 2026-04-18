import "./globals.css";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppProviders } from "./providers";
import { OfflineBanner } from "@/components/shared/offline-banner";
import { Toaster } from "@/components/ui/toaster";

const geistSans = localFont({
  src: "../../../packages/theme/fonts/GeistVF.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Frapp | Admin Dashboard",
  description: "The Operating System for Greek Life",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={geistSans.variable} suppressHydrationWarning>
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
