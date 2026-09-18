"use client";

import "./globals.css";
import * as Sentry from "@sentry/nextjs";
import localFont from "next/font/local";
import { useEffect } from "react";

/**
 * App Router last-resort error boundary. Replaces the root layout, so it
 * must render its own `<html>`/`<body>` and re-establish Figtree + the
 * landing stylesheet. Do not import landing components here — this boundary
 * catches failures in that tree.
 *
 * Signet, since the #2366 token cutover: same surface, same system. Every
 * colour here is a semantic token, so it tracks the ladder rather than
 * restating it.
 *
 * `Sentry.captureException` is a no-op when `NEXT_PUBLIC_LANDING_SENTRY_DSN`
 * is unset. The payload still goes through `beforeSend` when Sentry is live.
 */

const figtree = localFont({
  src: "../../../packages/theme/fonts/FigtreeVF.woff2",
  variable: "--font-figtree",
  weight: "400 700",
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
    <html lang="en" className={figtree.variable}>
      <body className="font-sans antialiased">
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
          <div className="w-full max-w-md text-center">
            <h1 className="text-headline text-foreground">
              This page could not load
            </h1>
            <p className="mt-3 text-body text-muted-foreground">
              The page couldn&apos;t finish loading, and the error has been
              reported. Reloading usually clears it.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              className="mt-6 inline-flex min-h-button items-center justify-center rounded-md bg-primary px-6 text-label text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
