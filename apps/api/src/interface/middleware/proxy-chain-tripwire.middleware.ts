import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { reportSwallowed } from '../../infrastructure/observability/report-swallowed';
import { forwardedShape } from '../utils/http-request-log';

/**
 * Make a wrong `trust proxy` hop count loud (#2972).
 *
 * A hop count trusts N forwarded entries whether or not N proxies appended
 * them. So when the real chain is shorter, the leftmost entry, the one the
 * client wrote, becomes `req.ip`. One forged `X-Forwarded-For` value then
 * picks the caller's own rate-limit bucket and `originHash`. Nothing about that
 * fails: every request still succeeds and resolves *an* address. Production
 * ran that way from its first deploy (a two-hop chain under a count measured
 * as three on staging) until the request log's `xffCount` was read.
 *
 * The chain the proxies append is a floor on what a deployed request carries:
 * a client can add entries, never remove the ones appended after it. So an
 * external request arriving with fewer entries than the hop count proves the
 * count is too high. One such request is reported to Sentry, once per process.
 * A request with no chain at all is Render's own health check, which reaches
 * the process directly, and it says nothing either way.
 *
 * Registered only on deployed processes (`configureApp`). A laptop has no
 * proxy, so every chain there is shorter than the count and means nothing.
 */
export function createProxyChainTripwire(trustedHops: number) {
  const logger = new Logger('TrustProxy');
  let reported = false;

  return function proxyChainTripwire(
    request: Request,
    _response: Response,
    next: NextFunction,
  ): void {
    if (!reported) {
      const { xffCount } = forwardedShape(request);
      if (xffCount > 0 && xffCount < trustedHops) {
        reported = true;
        const message = `trust proxy is ${trustedHops} hops, but a request arrived with a ${xffCount}-entry X-Forwarded-For chain. req.ip is client-controlled until the hop count is re-measured (#2972).`;
        logger.error(message);
        reportSwallowed(logger, 'the trust proxy check', () => ({
          message: 'trust proxy hop count exceeds the forwarded chain',
          level: 'error',
          tags: {
            trust_proxy_hops: String(trustedHops),
            xff_count: String(xffCount),
          },
          fingerprint: ['trust-proxy-hop-count'],
        }));
      }
    }
    next();
  };
}
