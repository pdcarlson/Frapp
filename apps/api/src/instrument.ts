/**
 * Sentry must be imported before the rest of the Nest graph so its Nest/HTTP
 * OpenTelemetry instrumentations patch modules as they load.
 *
 * ADR-22: Sentry owns the Node trace provider. Do not install
 * `@opentelemetry/sdk-node` (or any other global tracer) beside this.
 * `skipOpenTelemetrySetup` stays false in `buildSentryOptions`.
 *
 * Imported first from `main.ts`. Not imported from `AppModule` — e2e boots
 * the module without a DSN and must not call `Sentry.init`.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions } from './infrastructure/observability/sentry-options';
import { pseudonymsAvailable } from './infrastructure/observability/pseudonyms';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  if (!pseudonymsAvailable()) {
    // Without the salt, `beforeSend` cannot pseudonymize — it would strip the
    // identifiers instead, and every event would arrive unattributable.
    // `spec/behavior/observability.md` requires the hashes, so warn loudly
    // rather than let a misconfigured environment look healthy.
    Logger.warn(
      'SENTRY_DSN is set but ANALYTICS_HMAC_SALT is not — events will be ' +
        'reported with identifiers removed rather than pseudonymized. Set ' +
        'ANALYTICS_HMAC_SALT to make Sentry events attributable.',
      'Bootstrap',
    );
  }

  // Built in `sentry-options.ts` so the integration spec can assert against the
  // real configuration instead of a copy — see that file's note.
  Sentry.init(buildSentryOptions(dsn));
}
