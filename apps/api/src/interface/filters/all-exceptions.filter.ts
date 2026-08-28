import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { RequestContext } from '../types/request-context.types';
import { pathOnly } from '../utils/path-only';
import {
  pseudonymizeChapterId,
  pseudonymizeIp,
  pseudonymizeUserId,
} from '../../infrastructure/observability/pseudonyms';
import {
  buildSecurityEvent,
  securityEventKind,
} from '../../infrastructure/observability/security-events';
import { AuthFailureSpikeDetector } from '../../infrastructure/observability/auth-failure-spike';
import { toReportableError } from '../../infrastructure/observability/reportable-error';

/**
 * The single seam for error-shaped observability (issues #846, #481).
 *
 * Every denial the API issues — 401 from the auth guard, 403 from the chapter
 * or role guards, 429 from the throttler — arrives here as an `HttpException`,
 * which is why the work plan's "wire through the existing seams, not scattered
 * ad-hoc calls" resolves to this class and not `LoggingInterceptor`. The
 * interceptor logs every request at `log` level and cannot tell a denial from a
 * success; adding the branch there would mean re-deriving status semantics in a
 * place that already has them flattened.
 *
 * Three behaviors, by status class:
 *
 *  - **401 / 403 / 429** → a `warn`-level `security_event` record, plus (401
 *    only) the sliding-window spike detector.
 *  - **>= 500** → the existing `error` log, and now `Sentry.captureException`,
 *    which nothing previously called. `initializeSentry`'s `beforeSend` does the
 *    PII scrubbing; the scope set here carries only pre-pseudonymized ids.
 *  - Everything else → response only, as before.
 */
/**
 * The message a client should see, preserving whatever Nest actually built.
 *
 * `HttpException.message` is a *string* by construction: `initMessage()` uses
 * the response's `message` only when it is itself a string, and otherwise falls
 * back to the humanized class name. `ValidationPipe` builds its response with
 * `message` as an **array** of per-field failures, so every validation error
 * reaching this filter used to be flattened to the literal string
 * "Bad Request Exception" — the field detail was assembled, attached to the
 * exception, and then dropped one line before serialisation.
 *
 * That is why `apps/web/lib/utils.ts`'s `getErrorMessage`, which reads
 * `message`, can only ever show a user "Bad Request Exception" for a rejected
 * form. Reading the response object first keeps the array intact.
 *
 * Structured throws are unaffected: `ForbiddenException({ code, message })`
 * carries a string `message`, so it serialises exactly as before. Whether the
 * sibling `code` key should also be exposed is a separate contract decision —
 * see #1020 — and is deliberately not settled here.
 */
function extractMessage(exception: HttpException): string | string[] {
  const response = exception.getResponse();

  if (typeof response === 'string') return response;

  if (response && typeof response === 'object' && 'message' in response) {
    const { message } = response as { message?: unknown };
    if (typeof message === 'string') return message;
    if (
      Array.isArray(message) &&
      message.every((entry) => typeof entry === 'string')
    ) {
      return message;
    }
  }

  return exception.message;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  /**
   * The detector is constructor-injected with a default so the filter stays
   * zero-arg constructible — `main.ts` builds it with `new`, outside the Nest
   * container, and tests need to supply a deterministic one.
   */
  constructor(
    private readonly spikeDetector = new AuthFailureSpikeDetector(),
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();
    const request = ctx.getRequest<RequestContext>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? extractMessage(exception)
        : 'Internal server error';

    const requestId = request.requestId ?? 'unknown';

    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          requestId,
          userId: request.appUser?.id,
          chapterId: request.chapterId,
          method: request.method,
          // Same leak as the request log, at `error` level (#1260).
          path: pathOnly(request.url),
          statusCode: status,
          error: toReportableError(exception).stack,
        }),
      );
      this.reportToSentry(exception, request, status, requestId);
    } else {
      this.recordSecurityEvent(request, status, requestId);
    }

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] || 'Error',
      message,
      requestId,
    });
  }

  /**
   * Emit the `security_event` record for a denial, and escalate an auth-failure
   * spike to Sentry.
   *
   * Wrapped so an observability failure can never turn a clean 403 into a 500 —
   * the response has not been written yet at this point.
   */
  private recordSecurityEvent(
    request: RequestContext,
    status: number,
    requestId: string,
  ): void {
    const kind = securityEventKind(status);
    if (!kind) return;

    try {
      const originHash = pseudonymizeIp(clientIp(request));
      this.logger.warn(
        JSON.stringify(
          buildSecurityEvent({
            kind,
            statusCode: status,
            method: request.method,
            // Path only: a query string is free text on a public surface and
            // routinely carries tokens. The status/route pair is the signal.
            path: pathOnly(request.url),
            requestId,
            userId: request.appUser?.id,
            chapterId: request.chapterId,
            originHash,
          }),
        ),
      );

      if (kind !== 'auth_failure') return;

      // Key the window the same way the throttler keys its buckets
      // (`custom-throttler.guard.ts`): authenticated subject when there is one,
      // origin otherwise. Sharing the notion of "who" means this degrades
      // exactly as the rate limiter does behind a proxy rather than inventing a
      // second, differently-wrong one. `trust proxy` is set to the measured
      // hop count in `configureApp` (#864), so behind Render's edge this
      // resolves to the real caller rather than collapsing every
      // unauthenticated request into one bucket.
      const originKey =
        request.appUser?.id ?? originHash ?? clientIp(request) ?? 'unknown';
      const trip = this.spikeDetector.record(originKey);
      if (!trip) return;

      this.logger.warn(
        JSON.stringify({
          event: 'security_event',
          kind: 'auth_failure_spike',
          count: trip.count,
          threshold: trip.threshold,
          windowMs: trip.windowMs,
          originHash,
          timestamp: new Date().toISOString(),
        }),
      );

      Sentry.withScope((scope) => {
        scope.setLevel('warning');
        scope.setTag('security_event', 'auth_failure_spike');
        if (originHash) scope.setTag('origin', originHash);
        scope.setTag('failure_count', String(trip.count));
        scope.setTag('window_ms', String(trip.windowMs));
        Sentry.captureMessage(
          `Auth failure spike: ${trip.count} failures from one origin in ${
            trip.windowMs / 60_000
          }m`,
        );
      });
    } catch (error) {
      this.logger.warn(
        `security-event emission failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Report a 5xx to Sentry with pseudonymous identity only.
   *
   * The ids are hashed *here* rather than left for `beforeSend` because the
   * scrubber's rule for `event.user.id` is "keep it only if it already looks
   * like a pseudonym" — passing a raw uuid would simply drop it, losing the
   * grouping. Hashing at the source keeps the tag and the hashed uuids inside
   * the exception message identical, which is what makes them correlatable.
   */
  private reportToSentry(
    exception: unknown,
    request: RequestContext,
    status: number,
    requestId: string,
  ): void {
    try {
      Sentry.withScope((scope) => {
        const userHash = pseudonymizeUserId(request.appUser?.id);
        if (userHash) scope.setUser({ id: userHash });

        const chapterHash = pseudonymizeChapterId(request.chapterId);
        if (chapterHash) scope.setTag('chapter', chapterHash);

        scope.setTag('request_id', requestId);
        scope.setTag('status_code', String(status));
        if (request.method) scope.setTag('http_method', request.method);
        const path = pathOnly(request.url);
        if (path) scope.setTag('route', path);

        Sentry.captureException(toReportableError(exception));
      });
    } catch (error) {
      this.logger.warn(`Sentry capture failed: ${(error as Error).message}`);
    }
  }
}

/** Client address as Express resolved it — hashed before it goes anywhere. */
function clientIp(request: RequestContext): string | undefined {
  const forwarded = Array.isArray(request.ips) ? request.ips[0] : undefined;
  return forwarded ?? request.ip;
}
