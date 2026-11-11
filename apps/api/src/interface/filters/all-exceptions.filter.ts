import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { httpStatusClass, isPseudonymHex } from '@repo/observability';
import type { ApiErrorResponseDto } from '../dtos/api-error.dto';
import type { RequestContext } from '../types/request-context.types';
import { pathOnly } from '../utils/path-only';
import {
  emitSanitizedHttpRequestLog,
  hasMatchedExpressRoute,
} from '../utils/http-request-log';
import { getRequestId } from '../../infrastructure/observability/request-als';
import {
  pseudonymizeChapterId,
  pseudonymizeIp,
  pseudonymizeUserId,
} from '../../infrastructure/observability/pseudonyms';
import {
  authFailureAttributes,
  authFailureFields,
  buildSecurityEvent,
  securityEventKind,
  type AuthFailureContext,
  type AuthFailureDetail,
} from '../../infrastructure/observability/security-events';
import {
  CLIENT_VERSION_HEADER,
  clientVersionForLog,
} from '#domain/constants/client-version';
import { authFailureDetail } from '../guards/auth-rejected.exception';
import { requestApp } from '../http/request-app';
import { AuthFailureSpikeDetector } from '../../infrastructure/observability/auth-failure-spike';
import { toReportableError } from '../../infrastructure/observability/reportable-error';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { reportSwallowed } from '../../infrastructure/observability/report-swallowed';
import {
  captureSentryErrorCorrelated,
  enqueueSanitizedLog,
} from '../../infrastructure/analytics/posthog-runtime';
import { readDeployedCommit } from '../../infrastructure/observability/deployed-commit';

/**
 * The message a client should see, preserving whatever Nest actually built.
 *
 * `HttpException.message` is a *string* by construction: `initMessage()` uses
 * the response's `message` only when it is itself a string, and otherwise falls
 * back to the humanized class name. `ValidationPipe` builds its response with
 * `message` as an **array** of per-field failures, so every validation error
 * reaching this filter used to be flattened to the literal string
 * "Bad Request Exception" (fixed in #1312): the field detail was assembled,
 * attached to the exception, and then dropped one line before serialisation.
 * Reading the response object first keeps the array intact.
 *
 * Structured throws are unaffected: `ForbiddenException({ code, message })`
 * carries a string `message`. Its `code` travels separately, through
 * {@link extractCode}.
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

/**
 * The structured `code` a client can branch on, or `undefined` (#1020).
 *
 * A throw opts in by passing an object that carries one:
 * `new ForbiddenException({ code: 'chapter.module.disabled', message })`.
 * Only a non-empty string counts, so a numeric or blank `code` leaves the key
 * off the body rather than sending a value no client could match.
 *
 * Only an `HttpException` is read. A raw error that reaches this filter as a
 * 500 can carry a `code` of its own (PostgREST's `{ code: '23505', … }`,
 * Node's `ECONNRESET`), and that one names an implementation detail, not a
 * refusal, so it stays in the server log.
 */
function extractCode(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (!response || typeof response !== 'object') return undefined;
  const { code } = response as { code?: unknown };
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

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
 * Four behaviors, by status class:
 *
 *  - **401 / 403 / 429** → a `warn`-level `security_event` record, plus (401
 *    only) the sliding-window spike detector.
 *  - **>= 500** → the existing `error` log, and now `Sentry.captureException`,
 *    which nothing previously called, sent through `reportSwallowed`.
 *    `beforeSend` (built in `sentry-options.ts`) does the PII scrubbing; the
 *    capture context built here carries only pre-pseudonymized ids. There is
 *    no scope fork, so a tag set on the current scope would reach other
 *    events.
 *    `@SentryExceptionCaptured` / `SentryGlobalFilter` are deliberately not
 *    used: they would `captureException` the raw value (a non-Error
 *    throwable, such as a bare `{ code, message, details }` record, becomes
 *    `[object Object]`) and double-report every 5xx this filter already sends
 *    through `toReportableError`.
 *  - **Unmatched 4xx** (no Express `request.route`) → the same sanitized
 *    `request` log the interceptor emits for matched routes. Unmatched
 *    `/v1/…` 404s never enter `LoggingInterceptor`, so without this they would
 *    never reach PostHog Logs (#2078). Exception messages stay off that row.
 *    401 / 403 / 429 already have `security_event` and are not double-logged
 *    as `request` here. Matched 4xx keep the interceptor as the request-log
 *    seam so a controller `NotFoundException` is not emitted twice.
 *  - **Every status** → the response body, one `ApiErrorResponseDto`. Its
 *    contract, `code` included, is `spec/architecture/README.md` § 10.
 */
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

    const code =
      exception instanceof HttpException ? extractCode(exception) : undefined;

    const requestId = request.requestId ?? getRequestId() ?? 'unknown';

    if (status >= 500) {
      // caught-failure-exempt: this is the 5xx report; reportToSentry below sends it
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
          // A guard's 503 says only "could not verify" (#3143); what failed
          // is its cause. Sentry follows the cause, so the log line does too.
          // Through `toReportableError`, so a PostgREST record's `details`
          // (row values) stays out here as well.
          cause:
            exception instanceof Error && exception.cause !== undefined
              ? toReportableError(exception.cause).stack
              : undefined,
        }),
      );
      this.reportToSentry(exception, request, status, requestId);
      this.enqueueSanitizedErrorLog(request, status, requestId);
    } else {
      this.recordSecurityEvent(
        request,
        status,
        requestId,
        authFailureDetail(exception),
      );
      this.enqueueUnmatchedClientErrorLog(request, status);
    }

    const body: ApiErrorResponseDto = {
      statusCode: status,
      error: HttpStatus[status] || 'Error',
      message,
      requestId,
      // Absent rather than `null` when there is none, so a code-less error
      // serialises exactly as it did before `code` joined the contract.
      ...(code ? { code } : {}),
    };
    response.status(status).json(body);
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
    authFailure: AuthFailureDetail | undefined,
  ): void {
    const kind = securityEventKind(status);
    if (!kind) return;

    try {
      const originHash = pseudonymizeIp(clientIp(request));
      // Which app, from what the clients already send (#3907): enough to tell
      // a stale mobile build from a dashboard tab. Never the raw header.
      const context: AuthFailureContext = {
        authFailure,
        clientApp: request.headers ? requestApp(request) : undefined,
        clientVersion: clientVersionForLog(
          request.headers?.[CLIENT_VERSION_HEADER],
        ),
      };
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
            ...context,
          }),
        ),
      );

      this.enqueueSanitizedSecurityLog(
        request,
        kind,
        status,
        requestId,
        originHash,
        context,
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
      // An absent reason counts under the detector's `other`.
      const trip = this.spikeDetector.record(
        originKey,
        undefined,
        authFailure?.reason,
      );
      if (!trip) return;

      // Which 401s tripped it (#3907): the window's mix, and the tripping
      // request's detail and client, which a burst from one origin shares.
      // The record keeps the per-request field names, which here describe the
      // tripping request, and adds the mix as one flat string.
      const reasons = describeReasons(trip.labels);
      this.logger.warn(
        JSON.stringify({
          event: 'security_event',
          kind: 'auth_failure_spike',
          count: trip.count,
          threshold: trip.threshold,
          windowMs: trip.windowMs,
          originHash,
          ...authFailureFields(context),
          reasons: reasons.summary,
          timestamp: new Date().toISOString(),
        }),
      );

      reportSwallowed(this.logger, 'an auth-failure spike', () => ({
        message: `Auth failure spike: ${trip.count} failures from one origin in ${
          trip.windowMs / 60_000
        }m`,
        level: 'warning',
        tags: {
          security_event: 'auth_failure_spike',
          ...(originHash ? { origin: originHash } : {}),
          failure_count: String(trip.count),
          window_ms: String(trip.windowMs),
          ...spikeTags(context),
          auth_failure_reason: reasons.reason,
          auth_failure_reasons: reasons.summary,
        },
        fingerprint: ['auth-failure-spike'],
      }));
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        'security-event emission failed',
        error,
      );
    }
  }

  /**
   * Unmatched 4xx never reach `LoggingInterceptor`. Emit the sanitized request
   * log from here so PostHog Logs still sees `status_class=4xx` with a
   * path-only path. Skip security denials (already a `security_event` row)
   * and matched routes (the interceptor already logged).
   */
  private enqueueUnmatchedClientErrorLog(
    request: RequestContext,
    status: number,
  ): void {
    if (status < 400 || status >= 500) return;
    if (securityEventKind(status)) return;
    if (hasMatchedExpressRoute(request)) return;
    try {
      emitSanitizedHttpRequestLog(new Logger('HTTP'), request, status);
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        'unmatched-request log emission failed',
        error,
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
    const eventId = reportSwallowed(this.logger, `a ${status}`, () => {
      const userHash = pseudonymizeUserId(request.appUser?.id);
      const chapterHash = pseudonymizeChapterId(request.chapterId);
      const path = pathOnly(request.url);
      return {
        error: exception,
        level: 'error',
        tags: {
          ...(chapterHash ? { chapter: chapterHash } : {}),
          request_id: requestId,
          status_code: String(status),
          ...(request.method ? { http_method: request.method } : {}),
          ...(path ? { route: path } : {}),
        },
        ...(userHash ? { user: { id: userHash } } : {}),
      };
    });
    this.emitSentryErrorCorrelated(request, status, requestId, eventId);
  }

  /**
   * Content-free PostHog timeline marker. Never the exception, stack, body,
   * query, or message. Errors are counted only in Sentry.
   *
   * Guarded on its own, for the same reason the capture is: it reads the
   * active trace from the Sentry SDK, and the response has not been written.
   */
  private emitSentryErrorCorrelated(
    request: RequestContext,
    status: number,
    requestId: string,
    sentryEventId: string | undefined,
  ): void {
    if (!sentryEventId) return;
    try {
      const userHash = pseudonymizeUserId(request.appUser?.id);
      const chapterHash = pseudonymizeChapterId(request.chapterId);
      const distinctId =
        (isPseudonymHex(userHash) ? userHash : undefined) ??
        (isPseudonymHex(chapterHash) ? chapterHash : undefined) ??
        `req:${requestId}`;
      captureSentryErrorCorrelated(distinctId, {
        sentry_event_id: sentryEventId,
        trace_id: sentryTraceId(),
        request_id: requestId,
        route: pathOnly(request.url),
        status_class: httpStatusClass(status),
        release: readDeployedCommit(),
      });
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        'sentry-error-correlated emission failed',
        error,
      );
    }
  }

  private enqueueSanitizedErrorLog(
    request: RequestContext,
    status: number,
    requestId: string,
  ): void {
    const userHash = pseudonymizeUserId(request.appUser?.id);
    const chapterHash = pseudonymizeChapterId(request.chapterId);
    const statusClass = httpStatusClass(status);
    enqueueSanitizedLog({
      body: 'error',
      severity: 'ERROR',
      attributes: {
        request_id: requestId,
        method: request.method ?? 'UNKNOWN',
        path: pathOnly(request.url) ?? '/',
        status_code: status,
        ...(statusClass ? { status_class: statusClass } : {}),
        ...(userHash ? { user_hash: userHash } : {}),
        ...(chapterHash ? { chapter_hash: chapterHash } : {}),
      },
    });
  }

  private enqueueSanitizedSecurityLog(
    request: RequestContext,
    kind: string,
    status: number,
    requestId: string,
    originHash: string | undefined,
    context: AuthFailureContext,
  ): void {
    const userHash = pseudonymizeUserId(request.appUser?.id);
    const chapterHash = pseudonymizeChapterId(request.chapterId);
    const statusClass = httpStatusClass(status);
    enqueueSanitizedLog({
      body: 'security_event',
      severity: 'WARN',
      attributes: {
        kind,
        request_id: requestId,
        method: request.method ?? 'UNKNOWN',
        path: pathOnly(request.url) ?? '/',
        status_code: status,
        ...(statusClass ? { status_class: statusClass } : {}),
        ...(originHash ? { origin_hash: originHash } : {}),
        ...(userHash ? { user_hash: userHash } : {}),
        ...(chapterHash ? { chapter_hash: chapterHash } : {}),
        ...authFailureAttributes(context),
      },
    });
  }
}

/**
 * The tripping request's detail as Sentry tags: the shared attributes, with
 * values as strings (tags take nothing else) and `client_app` always present,
 * so a spike from a client neither header places reads `unknown`. The 401's
 * own `reason` stays off: the window's mix below replaces it.
 */
function spikeTags(context: AuthFailureContext): Record<string, string> {
  const tags: Record<string, string> = { client_app: 'unknown' };
  for (const [key, value] of Object.entries(authFailureAttributes(context))) {
    if (key !== 'reason') tags[key] = String(value);
  }
  return tags;
}

/**
 * A spike's reason mix as Sentry tags (#3907). `reason` is the one reason when
 * every failure in the window shared it, else `mixed`; `summary` lists each
 * with its count, largest first (`token_rejected:18,no_bearer:2`). The labels
 * are the guard's two reasons plus the detector's `other`, so the summary stays
 * short.
 */
function describeReasons(labels: Readonly<Record<string, number>>): {
  reason: string;
  summary: string;
} {
  const entries = Object.entries(labels).sort(
    ([a, countA], [b, countB]) => countB - countA || a.localeCompare(b),
  );
  return {
    reason: entries.length === 1 ? entries[0][0] : 'mixed',
    summary: entries.map(([label, count]) => `${label}:${count}`).join(','),
  };
}

/** Client address as Express resolved it — hashed before it goes anywhere. */
function clientIp(request: RequestContext): string | undefined {
  const forwarded = Array.isArray(request.ips) ? request.ips[0] : undefined;
  return forwarded ?? request.ip;
}

function sentryTraceId(): string | undefined {
  const getTraceData = (
    Sentry as typeof Sentry & {
      getTraceData?: () => Record<string, string> | undefined;
    }
  ).getTraceData;
  const header = getTraceData?.()?.['sentry-trace'];
  if (typeof header !== 'string' || header.length === 0) return undefined;
  const traceId = header.split('-')[0];
  return /^[0-9a-f]{16,32}$/i.test(traceId) ? traceId.toLowerCase() : undefined;
}
