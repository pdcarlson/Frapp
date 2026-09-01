import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import helmet from 'helmet';
import { AllExceptionsFilter } from './interface/filters/all-exceptions.filter';
import { requestIdMiddleware } from './interface/middleware/request-id.middleware';
import { VALIDATION_PIPE_OPTIONS } from './interface/pipes/validation-pipe.options';
import { LoggingInterceptor } from './interface/interceptors/logging.interceptor';

/**
 * Everything that shapes a request or a response, in one place.
 *
 * This exists because the e2e suite used to hand-roll its own copy of it. Each
 * spec set up versioning and the validation pipe and stopped there, so no e2e
 * test ever ran under `AllExceptionsFilter` — the suite exercised Nest's
 * *default* filter, which serialises an exception response object verbatim,
 * while production ships four fixed keys and drops everything else.
 *
 * That gap is not theoretical: `cross-tenant-isolation.e2e-spec.ts` asserted a
 * structured `code` on an error body and passed in CI every run until this
 * change, against a shape `main.ts` cannot emit (#1020). A test that green-lights behaviour
 * production cannot produce is worse than no test, because it is counted.
 *
 * So the fix is not "remember to add the filter in tests" — it is having one
 * list with two callers. Anything added here reaches production and the suite
 * together, and cannot silently reach only one.
 *
 * Deliberately NOT here: CORS and Swagger. Both are server-lifecycle concerns
 * with no bearing on how a handler's result is turned into a response, and
 * neither is meaningful against an in-memory test app. Helmet's security
 * headers (#483) are the opposite of that: every response carries them the
 * same way regardless of caller, and `supertest` against the in-memory app
 * asserts them exactly as it does for `trust proxy` below — so they belong
 * here, not in `main.ts`.
 */
/**
 * Express `trust proxy` hop count for the Render deployment.
 *
 * **Measured, not assumed** (#864). Probes against `api-staging.frapp.live` on
 * 2026-08-28 returned an `x-forwarded-for` length of 3, 4 and 5 for 0, 1 and 2
 * forged entries — exactly linear, so the infrastructure contribution is a
 * constant three: Render's Cloudflare edge, Render's ingress, and the origin
 * hop whose address arrives on the socket. Evidence, with the raw log lines:
 * https://github.com/pdcarlson/Frapp/issues/864#issuecomment-5457812781
 *
 * Why a count rather than `true`: `true` trusts the entire chain, so any client
 * can prepend a forged address and rotate it to evade the very rate limit this
 * restores — strictly worse than leaving the setting off. And why not the
 * intuitive small numbers: `1` resolves `req.ip` to a Render-internal address
 * and `2` to Cloudflare's edge, so both keep every unauthenticated caller in
 * one shared bucket while looking like a fix.
 *
 * Both public hostnames — `api-staging.frapp.live` and the default
 * `frapp-api-staging.onrender.com` — share one DNS record pointing at the same
 * Cloudflare-fronted Render addresses, so neither public path is a shorter
 * chain that would leave this over-trusting.
 *
 * **The limit of a hop count, stated rather than left sharp:** it trusts N
 * entries whether or not N proxies actually appended them. Where the real
 * chain is shorter — local dev, or any future direct-to-origin route — Express
 * returns the leftmost entry, so a client can set `req.ip` by sending one
 * `X-Forwarded-For` header (pinned by a test in `bootstrap.spec.ts`). That is
 * inert for the rate limiter locally and correct in the deployed environments
 * measured above, but a new ingress that bypasses Render's edge would need
 * this re-measured, not inherited. Trusting by address range instead of a
 * count would remove the assumption entirely — considered in #1341.
 *
 * This is the **staging** figure. `frapp-api-prod` is a separate service whose
 * chain has never been observed (#1273 — it has never deployed), so the value
 * is unverified there.
 */
export const TRUST_PROXY_HOPS = 3;

/** The one Express method used here — narrower than importing express types. */
interface ExpressSettable {
  set: (setting: string, value: unknown) => void;
}

/**
 * Helmet's *default* CSP already fits Swagger UI without loosening anything:
 * `@nestjs/swagger`'s generated `/docs` page (`SwaggerModule.setup` in
 * `main.ts`, no `customJs`/`customJsStr`) loads its bundle via same-origin
 * `<script src="...">` tags only — covered by the default `script-src
 * 'self'` — and inlines only `<style>` blocks, which the default `style-src`
 * already permits (`'self' https: 'unsafe-inline'`). Its icon `background-image`
 * is a `data:` URI, and the default `img-src` already includes `data:` too.
 * So the right move is to change nothing about CSP — verified by booting the
 * app and loading `/docs` and its bundle/CSS/init-script assets (see
 * `docs/internal/security/SECURITY_FIXES.md`) — rather than add an
 * `'unsafe-inline'` `script-src` exception Swagger never needed, which would
 * have weakened XSS protection on every route, not just `/docs`.
 *
 * The one directive this API does override: Helmet's default
 * `Cross-Origin-Resource-Policy` is `same-origin`, which Chrome/Firefox
 * enforce independently of CORS. The dashboard is deliberately cross-origin
 * from this API (`enableCors()` above allowlists `*.frapp.live` and the local
 * dev ports, with `credentials: true`) — left at the default, every
 * dashboard `fetch()` response body would be silently blocked client-side
 * even with a matching `Access-Control-Allow-Origin`. `'cross-origin'` is
 * correct here because the actual authorization boundary is CORS plus bearer
 * auth, not this header.
 */
const HELMET_OPTIONS = {
  crossOriginResourcePolicy: { policy: 'cross-origin' },
} as const;

export function configureApp(app: INestApplication): void {
  // First, so every response — success, error, or a guard rejection before
  // any handler runs — carries the same security headers.
  app.use(helmet(HELMET_OPTIONS));

  // Behind Render, Express must resolve the caller from `X-Forwarded-For`, or
  // `req.ip` is the proxy's address and every unauthenticated caller shares one
  // rate-limit bucket (`custom-throttler.guard.ts` falls back to `ip:` keying)
  // and one `originHash` (#864). It lives here rather than in `main.ts` so the
  // e2e suite runs under the same resolution production does — the #1020 gap
  // this whole function exists to close.
  const httpAdapter: { getInstance: () => unknown } = app.getHttpAdapter();
  const expressInstance = httpAdapter.getInstance() as ExpressSettable;
  expressInstance.set('trust proxy', TRUST_PROXY_HOPS);

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  // Before the Nest pipeline, so guard rejections carry a request id too — see
  // the middleware's own note on why this cannot be an interceptor.
  app.use(requestIdMiddleware);

  app.useGlobalInterceptors(new LoggingInterceptor());

  app.useGlobalFilters(new AllExceptionsFilter());
}
