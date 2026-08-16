import {
  createSentryScrubber,
  NO_PSEUDONYMS,
  type ScrubbableEvent,
} from "@repo/validation";
import type { BrowserOptions, NodeOptions } from "@sentry/nextjs";

/**
 * The single source of truth for how web Sentry is configured (issue #865).
 *
 * Modelled on `apps/api/src/infrastructure/observability/sentry-options.ts` and
 * for the same reason: extracting the option object is what lets a spec assert
 * against the configuration the app actually ships rather than a copy of it. A
 * copy drifts silently, and a test that asserts against its own literals proves
 * nothing about production.
 *
 * ## The browser holds no salt, and that is the whole design
 *
 * `ENV_REFERENCE.md` is explicit that `ANALYTICS_HMAC_SALT` is API-only:
 * exposing it to a client bundle would let the analytics dataset be
 * rainbow-tabled back to raw user ids. So this binding passes
 * {@link NO_PSEUDONYMS}, and every identifier the free-text sweep finds is
 * replaced with a placeholder (`[redacted:id]`) instead of a stable hash
 * (`[id:<hmac>]`). That is the shared scrubber's existing fail-closed branch —
 * the one the API takes when its own salt is unset — not new behavior.
 *
 * The one identifier that *does* survive is the user pseudonym, and it survives
 * because the **server** derived it: `sentry-identity-provider.tsx` reads it
 * from `GET /v1/analytics/identity` and hands it to `Sentry.setUser`. The
 * scrubber's `/^[0-9a-f]{64}$/` gate accepts that value and rejects everything
 * else, so a raw id put there by a stray `setUser` call is still dropped.
 */

const scrubber = createSentryScrubber(NO_PSEUDONYMS);

/**
 * Derived from the option types rather than imported by name, matching the API
 * module: `@sentry/nextjs` exports the option shapes but not the event ones, and
 * naming the events through the hooks keeps them in lockstep with the installed
 * SDK. A changed signature stops compiling here instead of silently scrubbing a
 * shape the SDK no longer sends.
 */
type BrowserErrorEvent = Parameters<NonNullable<BrowserOptions["beforeSend"]>>[0];
type BrowserTransactionEvent = Parameters<
  NonNullable<BrowserOptions["beforeSendTransaction"]>
>[0];
type ServerErrorEvent = Parameters<NonNullable<NodeOptions["beforeSend"]>>[0];
type ServerTransactionEvent = Parameters<
  NonNullable<NodeOptions["beforeSendTransaction"]>
>[0];

/**
 * Both hooks, for either runtime.
 *
 * The web app initializes Sentry three times — browser, Node server, and edge —
 * and all three must scrub. Wiring only the browser would leave server
 * components and route handlers reporting unscrubbed, which is the same
 * one-hook-of-two gap #896 closed on the API.
 */
function scrubError<T>(event: T): T | null {
  return scrubber.scrubSentryEvent(
    event as unknown as ScrubbableEvent,
  ) as T | null;
}

function scrubTransaction<T>(event: T): T | null {
  return scrubber.scrubSentryTransaction(
    event as unknown as ScrubbableEvent,
  ) as T | null;
}

/**
 * The DSN, or `undefined` when Sentry must stay dark.
 *
 * Written as a direct `process.env.NEXT_PUBLIC_SENTRY_DSN` reference on purpose:
 * Next inlines `NEXT_PUBLIC_*` reads at build time by static analysis, and a
 * dynamic lookup (`process.env[name]`) is not replaced, so it would read
 * `undefined` in the browser no matter what is configured.
 *
 * Empty string is treated as unset so a blank CI/Vercel variable no-ops rather
 * than sending the SDK a malformed DSN.
 */
export function webSentryDsn(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
}

/**
 * The environment tag, derived at build time from Vercel's own `VERCEL_ENV`.
 *
 * `next.config.js` maps it in under `env`, so this read is replaced at build
 * time and no secret-store entry exists for it. See that file for why it is
 * derived rather than configured — briefly: Vercel already knows which
 * environment a deployment is, and a hand-set copy fails silently when it
 * disagrees.
 *
 * The `?? "development"` here is for the non-Next callers (vitest, which loads
 * this module without the config's replacement applied), not a second default.
 */
function environment(): string {
  return process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development";
}

/**
 * Options shared by every runtime the web app initializes Sentry in.
 *
 * `sendDefaultPii: false` matches the API. Under v10 that is a key-name filter,
 * not a content filter — values under innocuously-named keys are still
 * collected — so it is a floor and the scrubber does the real work.
 */
export function buildWebSentryOptions(dsn: string): BrowserOptions {
  return {
    dsn,
    environment: environment(),
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
    ),
    sendDefaultPii: false,
    beforeSend: (event: BrowserErrorEvent) => scrubError(event),
    beforeSendTransaction: (event: BrowserTransactionEvent) =>
      scrubTransaction(event),
  };
}

/**
 * The server/edge counterpart. Identical rules; separate builder only because
 * `NodeOptions` and `BrowserOptions` type their hooks over different event
 * shapes, and returning one for the other would not type-check.
 */
export function buildServerSentryOptions(dsn: string): NodeOptions {
  return {
    dsn,
    environment: environment(),
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
    ),
    sendDefaultPii: false,
    beforeSend: (event: ServerErrorEvent) => scrubError(event),
    beforeSendTransaction: (event: ServerTransactionEvent) =>
      scrubTransaction(event),
  };
}
