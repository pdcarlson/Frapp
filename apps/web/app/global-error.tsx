"use client";

import "./globals.css";
import * as Sentry from "@sentry/nextjs";
import localFont from "next/font/local";
import { useEffect } from "react";

/**
 * The App Router's last-resort error boundary — it replaces the root layout, so
 * an error reaching here means the page is gone, not degraded.
 *
 * Reporting from here is the point of wiring Sentry into this file (#865):
 * `global-error` catches render errors that no other boundary did, and those
 * are exactly the ones nobody finds out about otherwise. The report goes
 * through `beforeSend`, so the scrubbing rules apply with nothing extra here —
 * and with no `NEXT_PUBLIC_SENTRY_DSN` configured, `Sentry.init` was never
 * called and `captureException` is an inert no-op.
 *
 * `useEffect` rather than a call during render: React may render a component
 * more than once for a single error, and reporting in the body would duplicate
 * the event each time.
 *
 * ## Why the #920 Profile & pre-auth slice repainted it
 *
 * It was the last screen in `apps/web/app/` with no design system at all —
 * inline `style={{ padding: "2rem" }}`, a bare `<button>`, no tokens and no
 * typeface, so a dark-only product's final error state rendered as black
 * Times-ish text on browser white. Its copy was `writing.md` §1's banned shape
 * ("Something went wrong" / "Try again") with none of §3's three parts.
 *
 * No screen family owns it, and slice 9 is the token-engine sweep — there is no
 * later slice for it to fall into. It is taken here deliberately, and named as
 * a widening in the PR.
 *
 * ## The constraint that shapes it
 *
 * Because it replaces the root layout it must render its own `<html>`/`<body>`
 * and re-establish both the stylesheet and the font, which the layout normally
 * does. But it must NOT import `@/components/ui/button`, `Card`, or anything
 * else from the component tree: this is the boundary that catches a failure in
 * that tree, and a last-resort screen that depends on the thing that broke can
 * fail to render the message about the failure. So the paint is token classes
 * on hand-written elements, deliberately. The obvious "cleanup" here is to
 * reach for `Button`; do not.
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
          <div className="flex w-full max-w-[400px] flex-col items-center gap-3 rounded-xl border border-destructive/[.28] bg-card p-6 text-center">
            {/*
              §10's error tile — 44px, radius 14, the danger hue at 13% with the
              AA-lifted tone on it. Drawn inline rather than imported from
              `shared/async-states.tsx` for the reason in the docstring above.
            */}
            <span
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-lg bg-destructive/[.13] text-[22px] font-bold leading-none text-destructive-text"
            >
              !
            </span>
            <h1 className="text-base font-bold text-foreground">
              The dashboard hit an unrecoverable error
            </h1>
            <p className="text-sm text-muted-foreground">
              The page couldn&apos;t finish loading, and the error has been
              reported. Reloading usually clears it.
            </p>
            {/*
              Byte-identical to `Button variant="secondary" size="sm"`'s recipe
              rather than a better one-off: `hover:bg-accent` is weak on a card
              (`--accent` aliases `--popover`, 1.085:1) but that is the
              primitive's defect on every surface, filed separately, and a
              last-resort screen quietly disagreeing with the button everywhere
              else is the drift the cutover rule forbids. §10 also bars the
              chapter accent from an error surface, which rules out the tint.
            */}
            <button
              type="button"
              onClick={() => reset()}
              className="mt-1 inline-flex h-11 items-center justify-center rounded-md border border-input bg-card px-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/25"
            >
              Reload the dashboard
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
