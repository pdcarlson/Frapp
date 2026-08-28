import * as Sentry from "@sentry/nextjs";
import { buildServerSentryOptions, webSentryDsn } from "@/lib/sentry/options";

/**
 * Server and edge Sentry initialization for apps/web (issue #865).
 *
 * `instrumentation.ts` at the app root is the Next 16 convention: `register()`
 * runs once per server instance before the first request is handled, and
 * `onRequestError` receives errors Next catches while rendering server
 * components, route handlers, and server actions. Verified against
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`
 * per `apps/web/AGENTS.md` — this Next version's conventions differ from older
 * `sentry.server.config.ts` layouts the Sentry wizard still emits.
 *
 * **No DSN means no initialization at all**, which is what keeps local dev,
 * `vitest`, and CI reporting nowhere. Same rule as the API's `main.ts`.
 */
export function register(): void {
  const dsn = webSentryDsn();
  if (!dsn) return;
  Sentry.init(buildServerSentryOptions(dsn));
}

/**
 * Errors Next caught on the server. Guarded on the DSN for the same reason
 * `register` is: with Sentry uninitialized this is a no-op, but calling into
 * the SDK at all on every server error is pointless work in an environment that
 * deliberately reports nowhere.
 *
 * The error payload goes through `beforeSend` exactly like any other event, so
 * the scrubbing rules apply here without anything extra.
 */
export const onRequestError: typeof Sentry.captureRequestError = (
  ...args
) => {
  if (!webSentryDsn()) return;
  return Sentry.captureRequestError(...args);
};
