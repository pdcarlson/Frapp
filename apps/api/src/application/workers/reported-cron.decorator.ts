import { Logger } from '@nestjs/common';
import { Cron, type CronOptions } from '@nestjs/schedule';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/**
 * `@Cron`, with a catch around the whole handler that reports a rejection to
 * Sentry (#3498). Every scheduled handler in the API uses this instead of
 * `@Cron`; `reported-cron.decorator.spec.ts` fails on a bare `@Cron`.
 *
 * Without it, `@nestjs/schedule` catches a rejected handler itself
 * (`wrapFunctionInTryCatchBlocks` in its `schedule.explorer.js`) and passes
 * the raw throwable to Nest's `logger.error`. The process stays up, but the
 * failure reaches no alert, and Nest's console logger can print a PostgREST
 * `details` field, the row values `logThrowable` exists to keep out of the
 * logs (#1669).
 *
 * Here a rejection goes through `reportCaughtFailure` at `error` level (the
 * tick's work was skipped) under the site `cron:<handler-name>`, kebab-cased,
 * so each handler is its own Sentry issue and reports at most once per
 * `CAUGHT_FAILURE_REPORT_INTERVAL_MS` however often it ticks. The handler
 * then resolves, so the scheduler logs nothing more. A handler's own catches
 * still come first: this is the seam for what they miss, and for the next
 * handler that has none.
 */
export function ReportedCron(
  cronTime: Parameters<typeof Cron>[0],
  options?: CronOptions,
): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const original: unknown = descriptor.value;
    if (typeof original !== 'function') {
      throw new TypeError(
        `@ReportedCron decorates a method; ${String(propertyKey)} is not one`,
      );
    }
    const owner = (target as { constructor: { name: string } }).constructor
      .name;
    const handler = String(propertyKey);
    const site = `cron:${kebabCase(handler)}`;
    const logger = new Logger(owner);

    const reported = async function (this: unknown, ...args: unknown[]) {
      try {
        return await (original as (...a: unknown[]) => unknown).apply(
          this,
          args,
        );
      } catch (error) {
        reportCaughtFailure(logger, {
          level: 'error',
          site,
          message: `${owner}.${handler} rejected; skipping this tick`,
          error,
        });
        return undefined;
      }
    };
    Object.defineProperty(reported, 'name', { value: handler });
    descriptor.value = reported as typeof descriptor.value;
    // `@Cron` stores its metadata on `descriptor.value`, so it must see the
    // wrapper, not the original, or the scheduler would run the bare method.
    return Cron(cronTime, options)(target, propertyKey, descriptor);
  };
}

/** `handleAutoAbsentSweep` → `handle-auto-absent-sweep`. */
function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}
