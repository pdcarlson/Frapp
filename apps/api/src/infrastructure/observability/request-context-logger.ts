import { inspect } from 'node:util';
import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { getRequestId } from './request-als';

type JsonLogOptions = {
  context: string;
  logLevel: LogLevel;
  writeStreamType?: 'stdout' | 'stderr';
  errorStack?: unknown;
};

/**
 * Nest's console logger with the request-correlation id on every record.
 *
 * The API keeps Nest's default format (`[Nest] <pid> - <ts> <LEVEL>
 * [<Context>]`) — that prefix is the only marker a caller cannot forge
 * (`spec/behavior/observability.md` § Structured Logging). This subclass
 * does not switch to JSON mode and does not replace the HTTP interceptor's
 * structured request log. It only puts `requestId` on the context so a
 * `Logger.log` from a service during a request is correlatable with the
 * interceptor line and the error body's `requestId`.
 *
 * Records emitted outside a request (boot, cron, workers) look exactly as
 * they did: no store, no extra token.
 *
 * On Cloud Run it runs in Nest's JSON mode instead (`bootstrap.ts`),
 * one record per line, shaped for Cloud Logging (`getJsonLogObject`).
 */
export class RequestContextLogger extends ConsoleLogger {
  protected formatContext(context: string): string {
    const requestId = getRequestId();
    if (!requestId) {
      return super.formatContext(context);
    }
    if (!context) {
      return super.formatContext(requestId);
    }
    return super.formatContext(`${context} ${requestId}`);
  }

  /**
   * How a record prints in JSON mode, which the API uses on Cloud Run (#5228)
   * so Cloud Logging can filter by level and field. The record follows Cloud
   * Logging's structured-log rules: `severity` sets the entry's level and
   * `time` its timestamp (Nest's numeric `timestamp` is not a form it reads),
   * and the rest lands in `jsonPayload`. A message that is itself a JSON
   * object (the request log, `security_event`, `push_delivery`) is also
   * parsed into `data`, so its fields can be queried
   * (`jsonPayload.data.statusCode>=500`). It goes under `data`, never the top
   * level, so a logged object can't set `severity` or `requestId`. Each
   * record is one line with every string escaped, so caller text can't start
   * a line of its own.
   */
  protected printAsJson(message: unknown, options: JsonLogOptions): void {
    const { timestamp, ...logObject } = this.getJsonLogObject(message, options);
    const data = parsedObject(message);
    const line = this.stringifyRecord({
      severity: CLOUD_LOGGING_SEVERITY[options.logLevel] ?? 'DEFAULT',
      time: new Date(timestamp).toISOString(),
      ...logObject,
      ...(data ? { data } : {}),
    });
    if (this.options.forceConsole) {
      if (options.writeStreamType === 'stderr') console.error(line);
      else console.log(line);
      return;
    }
    process[options.writeStreamType ?? 'stdout'].write(`${line}\n`);
  }

  /**
   * Nest's own JSON serializer (Errors, Maps and BigInts inspected, long
   * output truncated); a record it can't serialize, such as one holding a
   * cycle, prints with its message inspected instead of being lost.
   */
  private stringifyRecord(record: Record<string, unknown>): string {
    try {
      return this.stringifyJsonLogObject(record);
    } catch {
      return this.stringifyJsonLogObject({
        ...record,
        message: inspect(record.message, { breakLength: Infinity }),
        data: undefined,
      });
    }
  }

  protected getJsonLogObject(message: unknown, options: JsonLogOptions) {
    const logObject = super.getJsonLogObject(message, options);
    const requestId = getRequestId();
    return requestId ? { ...logObject, requestId } : logObject;
  }
}

const CLOUD_LOGGING_SEVERITY: Record<LogLevel, string> = {
  verbose: 'DEBUG',
  debug: 'DEBUG',
  log: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/** A message's fields when the whole message is a JSON object, else null. */
function parsedObject(message: unknown): Record<string, unknown> | null {
  if (typeof message !== 'string' || !message.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(message);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
