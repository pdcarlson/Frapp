/**
 * Sentry must be imported before the rest of the Nest graph so its
 * load-time module hooks (which instrument modules such as Express as they
 * load) are in place before those modules are required.
 *
 * ADR-22: Sentry owns the API's tracing. Do not install
 * `@opentelemetry/sdk-node` (or any other global tracer) beside this.
 * `enableOpenTelemetrySetup` stays false in `buildSentryOptions`.
 *
 * Imported first from `main.ts`. Not imported from `AppModule` — e2e boots
 * the module without a DSN and must not call `Sentry.init`.
 *
 * **Nothing here may load `@nestjs/*`** (or anything that does) before
 * `Sentry.init`. SDK v11 instruments `@nestjs/common`'s `@Injectable()` and
 * `@Catch()` by rewriting those files as they load, and the hooks that do it
 * are registered inside `init`. A copy loaded earlier stays unrewritten, and
 * every middleware, guard, pipe, interceptor and filter span is lost without
 * a warning. That is why the missing-salt warning is logged by `main.ts`
 * rather than here: `Logger` lives in `@nestjs/common`.
 * `instrument.spec.ts` loads this file with every `@nestjs/*` package mocked
 * to throw, and checks that `main.ts` imports it first.
 */
import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions } from './infrastructure/observability/sentry-options';
import { pseudonymsAvailable } from './infrastructure/observability/pseudonyms';

const dsn = process.env.SENTRY_DSN;

/**
 * True when Sentry is on but `ANALYTICS_HMAC_SALT` is not. Without the salt,
 * `beforeSend` cannot pseudonymize: it strips identifiers instead, so every
 * event arrives unattributable. `spec/behavior/observability.md` requires
 * the hashes, so `main.ts` warns loudly rather than let a misconfigured
 * environment look healthy.
 */
export const sentryReportsWithoutPseudonyms =
  Boolean(dsn) && !pseudonymsAvailable();

if (dsn) {
  // Built in `sentry-options.ts` so the integration spec can assert against the
  // real configuration instead of a copy — see that file's note.
  Sentry.init(buildSentryOptions(dsn));
}
