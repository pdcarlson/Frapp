import type { NodeOptions } from '@sentry/nestjs';
import { scrubSentryEvent, scrubSentryTransaction } from './sentry-scrubbing';

/**
 * The single source of truth for how Sentry is configured (issues #481, #682).
 *
 * This lives apart from `main.ts` for one reason: `main.ts` ends in
 * `void bootstrap()`, so importing it to inspect the options would boot the
 * whole application. Extracting the option object is what lets
 * `sentry-integration.spec.ts` assert against the configuration the API
 * actually ships rather than a copy of it — a copy can drift silently, and a
 * test that asserts against its own literals proves nothing about production.
 *
 * The `tracesSampleRate` read below is unvalidated: a malformed value yields
 * `NaN`, which the SDK treats as "tracing enabled". Tracked in #904.
 */
export function buildSentryOptions(dsn: string): NodeOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    /**
     * Under v10 this no longer means "collect nothing". It resolves to a
     * key-based filter: `authorization`, `cookie`, and anything else matching
     * the SDK's sensitive-key list come back as `[Filtered]`, request bodies
     * are not collected at all (`httpBodies: []`), and the client IP is not
     * inferred (`userInfo: false`). Values under innocuously-named keys are
     * still collected verbatim, which is why `beforeSend` below does the real
     * work rather than this flag.
     */
    sendDefaultPii: false,
    /**
     * Every **error** event leaves through here. See `sentry-scrubbing.ts` for
     * the rules and why they are allowlists.
     */
    beforeSend: scrubSentryEvent,
    /**
     * Every **transaction** (tracing) event leaves through here. The SDK routes
     * the two classes to two different hooks, so both must be set or one class
     * ships unscrubbed — which is what #896 fixed.
     *
     * These are deliberately two functions rather than one: `scrubSentryEvent`
     * would drop every span, because `spans` is not on its allowlist, and the
     * transaction would still be delivered — just with an empty trace payload.
     */
    beforeSendTransaction: scrubSentryTransaction,
  };
}
