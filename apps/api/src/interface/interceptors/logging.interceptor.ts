import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import type { RequestContext } from '../types/request-context.types';

/**
 * Shape of the `X-Forwarded-For` chain, carrying no address.
 *
 * `spec/behavior/observability.md` § Structured Logging forbids logging IP
 * addresses unconditionally, so this records only what is needed to choose an
 * Express `trust proxy` hop count (#864). The addresses themselves are compared
 * in process and never emitted.
 */
export interface ForwardedShape {
  /**
   * Entries in `x-forwarded-for`; `0` when the header is absent or empty.
   *
   * This is the field that determines the hop count: probe with a known number
   * of forged entries and subtract, and the remainder is what the proxies in
   * front actually appended.
   */
  xffCount: number;
  /**
   * Whether the socket peer *also* appears as the chain's final entry.
   *
   * Normally `false`, and that is not a problem: each proxy appends the peer it
   * received from, so the nearest proxy's own address is the one address the
   * chain does not contain. It does **not** discriminate a one-hop chain from a
   * two-hop one — `xffCount` does that. A `true` here flags a non-standard
   * chain (something echoing its own address) and means the count should be
   * sanity-checked before `trust proxy` is set from it.
   */
  xffSocketIsLast: boolean;
}

/** Strips the IPv4-mapped IPv6 prefix so `::ffff:1.2.3.4` compares equal to `1.2.3.4`. */
function normalizeAddress(value: string): string {
  const lower = value.trim().toLowerCase();
  return lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : lower;
}

export function forwardedShape(request: Partial<Request>): ForwardedShape {
  // Read the header directly rather than `req.ips`, which Express leaves empty
  // until `trust proxy` is set — the very setting this exists to inform. Also
  // not `getHeaderValue`, which takes only the first value of a repeated header
  // and would undercount a chain split across several `X-Forwarded-For` lines.
  const header = request.headers?.['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const socket = request.socket?.remoteAddress;
  const last = entries[entries.length - 1];

  return {
    xffCount: entries.length,
    xffSocketIsLast:
      last !== undefined &&
      socket !== undefined &&
      normalizeAddress(last) === normalizeAddress(socket),
  };
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<{
            statusCode?: number;
          }>();
          this.log(request, response.statusCode, Date.now() - start);
        },
        error: (err: { status?: number }) => {
          this.log(request, err.status ?? 500, Date.now() - start);
        },
      }),
    );
  }

  private log(
    request: RequestContext & Request,
    statusCode: number | undefined,
    latencyMs: number,
  ): void {
    const { xffCount, xffSocketIsLast } = forwardedShape(request);

    this.logger.log(
      JSON.stringify({
        requestId: request.requestId,
        userId: request.appUser?.id,
        chapterId: request.chapterId,
        method: request.method,
        path: request.url,
        statusCode: statusCode ?? 500,
        latencyMs,
        xffCount,
        xffSocketIsLast,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
