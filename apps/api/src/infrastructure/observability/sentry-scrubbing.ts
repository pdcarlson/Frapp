import {
  createSentryScrubber,
  type ScrubbableEvent,
  type SentryPseudonymizer,
} from '@repo/validation';
import type { ErrorEvent, NodeOptions } from '@sentry/nestjs';
import { pseudonymizeIp, pseudonymizeUserId } from './pseudonyms';

/**
 * The API's binding of the shared Sentry scrubber (#481, #896, #865).
 *
 * The rules themselves moved to `@repo/validation` when #865 needed the
 * identical scrubbing on the browser side — see that module's docblock for the
 * allowlist doctrine and for why each allowlist looks the way it does. What
 * stays here is the part that is genuinely API-specific:
 *
 *  - **the pseudonymizer**, which reads `ANALYTICS_HMAC_SALT` from the process
 *    environment. That salt is API-only on purpose (`ENV_REFERENCE.md`), so the
 *    shared module takes it as an injected dependency rather than reaching for
 *    `process.env` — which does not exist in a browser and must not hold this
 *    value anyway;
 *  - **the SDK types.** `@repo/validation` is also a dependency of
 *    `apps/mobile`, which has no Sentry installed, so the shared module cannot
 *    name `@sentry/*` even in an `import type` — the emitted `.d.ts` would fail
 *    to resolve there. Binding the structural shapes to `ErrorEvent` and the
 *    real `beforeSendTransaction` parameter happens here instead, which is also
 *    where a breaking SDK change should surface: `buildSentryOptions` assigns
 *    these two functions to `NodeOptions`, so a changed hook signature stops
 *    compiling rather than silently scrubbing a shape the SDK no longer sends.
 *
 * The exported names and signatures are unchanged from before the move, which
 * is why `sentry-scrubbing.spec.ts` and `sentry-integration.spec.ts` still pass
 * without modification — the stated signal that the extraction was clean.
 */

/**
 * Derived from the option type rather than imported by name.
 *
 * `@sentry/node` re-exports `ErrorEvent` but neither `TransactionEvent` nor
 * `SpanJSON`, so there is no name to import here. Naming them through the hook
 * this module is wired into keeps both in lockstep with the installed SDK.
 */
type TransactionEvent = Parameters<
  NonNullable<NodeOptions['beforeSendTransaction']>
>[0];

/**
 * The API can pseudonymize, so identifiers are hashed rather than dropped: a
 * UUID inside an exception message becomes the same digest as the `user` field
 * on the same event, and an operator can correlate the two. Both helpers return
 * `undefined` when the salt is unset, and the shared scrubber treats that as
 * "drop the value" — the fail-closed path, never a raw identifier.
 */
const apiPseudonyms: SentryPseudonymizer = {
  pseudonymizeUserId,
  pseudonymizeIp,
};

const scrubber = createSentryScrubber(apiPseudonyms);

/**
 * Best-effort PII sweep over a free-text string (exception messages, culprits,
 * transaction names, breadcrumb messages). See the shared module for the rules.
 */
export const redactFreeText = scrubber.redactFreeText;

/**
 * `beforeSend`: the last thing that runs before an error event leaves the
 * process. Returns the scrubbed event, or `null` to drop it entirely.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  return scrubber.scrubSentryEvent(
    event as unknown as ScrubbableEvent,
  ) as ErrorEvent | null;
}

/**
 * `beforeSendTransaction`: the transaction-event counterpart. Same doctrine,
 * same fail-closed contract; it differs in keeping `spans` and rebuilding each
 * span field-by-field, which is why it cannot be the same function (#896).
 */
export function scrubSentryTransaction(
  event: TransactionEvent,
): TransactionEvent | null {
  return scrubber.scrubSentryTransaction(
    event as unknown as ScrubbableEvent,
  ) as TransactionEvent | null;
}
