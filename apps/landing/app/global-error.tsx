"use client";

import "./globals.css";
import * as Sentry from "@sentry/nextjs";
import localFont from "next/font/local";
import { useEffect } from "react";

/**
 * App Router last-resort error boundary. Replaces the root layout, so it
 * must render its own `<html>`/`<body>` and re-establish Geist + the
 * landing stylesheet. Do not import landing components here — this boundary
 * catches failures in that tree.
 *
 * Frozen bone/bronze + Geist: do not Signet-reskin this screen.
 *
 * `Sentry.captureException` is a no-op when `NEXT_PUBLIC_LANDING_SENTRY_DSN`
 * is unset. The payload still goes through `beforeSend` when Sentry is live.
 */

const geistSans = localFont({
  src: "../../../packages/theme/fonts/GeistVF.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className={geistSans.variable}>
      <body className="font-sans antialiased">
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
          <div className="w-full max-w-md text-center">
            <h1 className="text-2xl font-bold tracking-tight text-navy dark:text-white">
              This page could not load
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              The page couldn&apos;t finish loading, and the error has been
              reported. Reloading usually clears it.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
