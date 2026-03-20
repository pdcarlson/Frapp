import "./globals.css";
import type { Metadata } from "next";
import localFont from "next/font/local";

const geistSans = localFont({
  src: "../../../packages/theme/fonts/GeistVF.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Frapp — The Operating System for Greek Life",
  description:
    "Replace Discord, OmegaFi, and Life360 with one app. Chat, events, study hours, points, and billing for fraternity chapters.",
  metadataBase: new URL("https://frapp.live"),
  openGraph: {
    title: "Frapp — The Operating System for Greek Life",
    description:
      "One platform for chat, events, study hours, points, backwork, and billing.",
    type: "website",
    url: "https://frapp.live",
  },
  twitter: {
    card: "summary_large_image",
    title: "Frapp — The Operating System for Greek Life",
    description:
      "One platform for chat, events, study hours, points, backwork, and billing.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={geistSans.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
