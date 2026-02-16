import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "next-themes";
import { QueryProvider } from "../components/providers/query-provider";
import { FrappProvider } from "../components/providers/frapp-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frapp | The Operating System for Greek Life",
  description: "Manage your chapter's operations, financials, and events in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className="antialiased font-sans">
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <QueryProvider>
              <FrappProvider>{children}</FrappProvider>
            </QueryProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
