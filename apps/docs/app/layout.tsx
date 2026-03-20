import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "../components/sidebar";
import { MobileNav } from "../components/mobile-nav";
import { SpeedInsights } from "@vercel/speed-insights/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Frapp Docs",
  description:
    "Guides and references for building and running Frapp — The Operating System for Greek Life.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <div className="relative min-h-screen bg-background text-foreground">
          <Sidebar />

          <div className="md:pl-64">
            <MobileNav />
            <main className="mx-auto max-w-[860px] px-6 py-10 sm:px-10 sm:py-14">
              {children}
            </main>
          </div>
        </div>
        <SpeedInsights />
      </body>
    </html>
  );
}
