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

  protected getJsonLogObject(message: unknown, options: JsonLogOptions) {
    const logObject = super.getJsonLogObject(message, options);
    const requestId = getRequestId();
    return requestId ? { ...logObject, requestId } : logObject;
  }
}
