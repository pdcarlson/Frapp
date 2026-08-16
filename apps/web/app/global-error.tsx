"use client";

import * as Sentry from "@sentry/nextjs";
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
 */
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
    <html lang="en">
      <body>
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>Something went wrong</h2>
          <button onClick={() => reset()} style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
