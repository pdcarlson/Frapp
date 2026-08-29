import {
  createSentryScrubber,
  NO_PSEUDONYMS,
  type ScrubbableEvent,
} from "@repo/validation";
import type { ReactNativeOptions } from "@sentry/react-native";

/**
 * The single source of truth for how mobile Sentry is configured (issue #1299).
 *
 * Modelled on `apps/web/lib/sentry/options.ts`, which is itself modelled on
 * `apps/api/src/infrastructure/observability/sentry-options.ts`, and for the
 * same reason all three give: extracting the option object is what lets a spec
 * assert against the configuration the app actually ships rather than a copy of
 * it. A copy drifts silently, and a test that asserts against its own literals
 * proves nothing about production.
 *
 * The import of `@sentry/react-native` here is **type-only on purpose**. It
 * keeps this module free of any native binding, so the spec can exercise the
 * real shipped options under vitest — where `react-native` is aliased to
 * `react-native-web` and the SDK's native module does not exist.
 *
 * ## The bundle holds no salt, and that is the whole design
 *
 * A React Native bundle is as readable as a browser bundle, so the reasoning
 * `apps/web` records applies here unchanged: `ANALYTICS_HMAC_SALT` is API-only
 * (`ENV_REFERENCE.md`), because exposing it to a client would let the analytics
 * dataset be rainbow-tabled back to raw user ids. So this binding passes
 * {@link NO_PSEUDONYMS}, and every identifier the free-text sweep finds is
 * replaced with a placeholder (`[redacted:id]`) instead of a stable hash
 * (`[id:<hmac>]`). That is the shared scrubber's existing fail-closed branch —
 * the one the API takes when its own salt is unset — not new behavior.
 *
 * Mobile currently sets no user on the Sentry scope at all, so unlike web there
 * is not even a server-derived pseudonym in play. If one is ever added it must
 * come from `GET /v1/analytics/identity` exactly as `sentry-identity-provider`
 * does on web; the scrubber's `/^[0-9a-f]{64}$/` gate accepts that value and
 * rejects everything else, so a raw id put there by a stray `setUser` call is
 * still dropped.
 */

const scrubber = createSentryScrubber(NO_PSEUDONYMS);

/**
 * Derived from the option type rather than imported by name, matching the web
 * and API modules: the SDK exports the option shape but not the event ones, and
 * naming the events through the hooks keeps them in lockstep with the installed
 * SDK. A changed signature stops compiling here instead of silently scrubbing a
 * shape the SDK no longer sends.
 */
type ErrorEvent = Parameters<NonNullable<ReactNativeOptions["beforeSend"]>>[0];
type TransactionEvent = Parameters<
  NonNullable<ReactNativeOptions["beforeSendTransaction"]>
>[0];

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
 * Written as a direct `process.env.EXPO_PUBLIC_SENTRY_DSN` reference on purpose:
 * Expo inlines `EXPO_PUBLIC_*` reads at build time by static analysis, and a
 * dynamic lookup (`process.env[name]`) is not replaced, so it would read
 * `undefined` in a built app no matter what is configured. Same constraint as
 * `NEXT_PUBLIC_*` on web.
 *
 * Empty string is treated as unset so a blank EAS variable no-ops rather than
 * sending the SDK a malformed DSN.
 *
 * **There is no Infisical→EAS sync** — the six live syncs are Render + Vercel
 * only (`SECRETS_MANAGEMENT.md` §5) — so unlike every `NEXT_PUBLIC_*` this does
 * not arrive by itself. It is entered per build profile in the EAS dashboard.
 * A DSN authorizes *writing* events, not reading them, so `EXPO_PUBLIC_` is the
 * correct prefix.
 */
export function mobileSentryDsn(): string | undefined {
  return process.env.EXPO_PUBLIC_SENTRY_DSN || undefined;
}

/**
 * The environment tag.
 *
 * Unlike web there is no platform-supplied signal to derive this from: Vercel
 * sets `VERCEL_ENV` for the browser build, but an EAS build profile exposes
 * nothing equivalent to the bundle (`EAS_BUILD_PROFILE` is unprefixed, so it is
 * never inlined). So it is set per profile in the committed `eas.json`
 * alongside `EXPO_PUBLIC_API_URL`, which keeps the mapping in the repo and
 * reviewable rather than hidden in a dashboard.
 *
 * The default matters: Sentry treats an unset `environment` as `production`, so
 * omitting this would file every simulator and Expo Go error under the same tag
 * as a real member's crash. `development` is the safe default for a build that
 * never went through EAS.
 */
function environment(): string {
  return process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || "development";
}

/**
 * Tracing sample rate.
 *
 * A constant rather than an environment variable, which is a deliberate
 * departure from web and the API. Both of those can be retuned per environment
 * through Infisical without a rebuild; mobile cannot — there is no sync into
 * EAS, and an `EXPO_PUBLIC_*` value is inlined at build time anyway, so a
 * variable here would buy no tuning that editing this line does not.
 *
 * It also closes #904's failure mode by construction: a malformed
 * `SENTRY_TRACES_SAMPLE_RATE` yields `NaN`, which the SDK treats as tracing
 * *enabled*. A literal cannot be malformed. The value matches the other two
 * surfaces' default.
 */
const TRACES_SAMPLE_RATE = 0.1;

/**
 * The options the app actually ships.
 *
 * `sendDefaultPii: false` matches web and the API. Under v10 that is a key-name
 * filter, not a content filter — values under innocuously-named keys are still
 * collected — so it is a floor and the scrubber does the real work.
 *
 * Both hooks are wired. Setting only one leaves the other event class shipping
 * unscrubbed, which is the gap #896 closed on the API.
 */
export function buildMobileSentryOptions(dsn: string): ReactNativeOptions {
  return {
    dsn,
    environment: environment(),
    tracesSampleRate: TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend: (event: ErrorEvent) => scrubError(event),
    beforeSendTransaction: (event: TransactionEvent) => scrubTransaction(event),
  };
}
