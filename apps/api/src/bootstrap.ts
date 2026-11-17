import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './interface/filters/all-exceptions.filter';
import { corsOptionsFor } from './interface/http/cors.options';
import {
  deploymentEnvironment,
  type DeploymentEnvironment,
} from './interface/http/deployment-environment';
import { createProxyChainTripwire } from './interface/middleware/proxy-chain-tripwire.middleware';
import { bodyParserErrorMiddleware } from './interface/middleware/body-parser-errors.middleware';
import { requestIdMiddleware } from './interface/middleware/request-id.middleware';
import { requestReadsMiddleware } from './interface/middleware/request-reads.middleware';
import { RequestReadsInterceptor } from './interface/interceptors/request-reads.interceptor';
import { VALIDATION_PIPE_OPTIONS } from './interface/pipes/validation-pipe.options';
import { LoggingInterceptor } from './interface/interceptors/logging.interceptor';
import { RequestContextLogger } from './infrastructure/observability/request-context-logger';
import { runsOnCloudRun } from './config/runtime-platform';

/**
 * Everything that shapes a request or a response, in one place.
 *
 * This exists because the e2e suite used to hand-roll its own copy of it. Each
 * spec set up versioning and the validation pipe and stopped there, so no e2e
 * test ever ran under `AllExceptionsFilter` — the suite exercised Nest's
 * *default* filter, which serialises an exception response object verbatim,
 * while production ships the filter's fixed envelope and nothing else.
 *
 * That gap is not theoretical: `cross-tenant-isolation.e2e-spec.ts` asserted a
 * structured `code` on an error body and passed in CI every run until this
 * change, against a shape `main.ts` could not emit (#1020). A test that green-lights behaviour
 * production cannot produce is worse than no test, because it is counted.
 *
 * So the fix is not "remember to add the filter in tests" — it is having one
 * list with two callers. Anything added here reaches production and the suite
 * together, and cannot silently reach only one.
 *
 * Deliberately NOT here: Swagger. It is a server-lifecycle concern with no
 * bearing on how a handler's result is turned into a response, and it is not
 * meaningful against an in-memory test app. CORS used to sit in that carve-out
 * too; that was wrong. `exposedHeaders` *is* how a handler's result reaches
 * browser JS (report/search truncation flags, `x-request-id`), and leaving
 * `enableCors` only in `main.ts` meant the suite never saw the headers a
 * cross-origin dashboard is allowed to read. Helmet's security headers (#483)
 * are the same class: every response carries them the same way regardless of
 * caller, and `supertest` against the in-memory app asserts them — so CORS
 * belongs here, not in `main.ts`.
 */
/**
 * Express `trust proxy` hop count, per deployment.
 *
 * **Measured, not assumed, and measured per service**, because services on
 * different hosts do not have the same chain:
 *
 * - **Staging: 2** (#5269). Cloud Run behind Google's global external
 *   Application Load Balancer (the service's ingress is
 *   internal-and-cloud-load-balancing, so `run.app` refuses the internet).
 *   Google documents the balancer's header as `[SUPPLIED_VALUE,] CLIENT_IP,
 *   LOAD_BALANCER_IP`, and the forged-entry probe in
 *   `docs/ops/deployment/cloud-run.md` § Address measured exactly that on
 *   2026-11-17: a request with no `X-Forwarded-For` logged `xffCount` 2 and
 *   one with a single forged entry logged 3, so the balancer appends two
 *   entries and the forged one stays untrusted. Before the move, on Render
 *   behind Cloudflare, staging was 3 (#864: probes on 2026-08-28 with 0, 1
 *   and 2 forged entries returned 3, 4 and 5).
 * - **Production: 2** (#2972). `frapp-api-prod` on Render logs `xffCount` 2
 *   for callers that send no chain of their own (Stripe's webhook deliveries,
 *   a scanner; Render logs, 2026-09-29 and 30). This value used to be the
 *   staging figure applied to production unobserved, which left one entry of
 *   production's chain client-supplied: a single forged `X-Forwarded-For`
 *   value set `req.ip` and with it the caller's own rate-limit bucket.
 *   Production moves to Cloud Run behind its own balancer of the same shape
 *   (#5228), which documents the same two entries; re-check `xffCount` there
 *   after its cutover.
 *
 * Why a count rather than `true`: `true` trusts the entire chain, so any client
 * can prepend a forged address and rotate it to evade the very rate limit this
 * restores — strictly worse than leaving the setting off. And why not a
 * smaller number than the measured one: behind the balancer, `1` resolves
 * `req.ip` to the balancer's own address (on Render it was Render's or
 * Cloudflare's), which keeps every unauthenticated caller in one shared bucket
 * while looking like a fix.
 *
 * Each environment must have one public path, or the shorter chain
 * over-trusts. Staging's Cloud Run service has one, the balancer, with both
 * of its hosts (`api-staging.frapp.live` and the deploy's `candidate.` host)
 * the same chain; its old Render service stays up as the rollback until
 * #5228 removes it, and runs its own older build with Render's count.
 * Production's two Render hostnames have not been compared that way; the
 * tripwire below covers a shorter one.
 *
 * **The limit of a hop count, stated rather than left sharp:** it trusts N
 * entries whether or not N proxies actually appended them. Where the real
 * chain is shorter — local dev, or any future direct-to-origin route — Express
 * returns the leftmost entry, so a client can set `req.ip` by sending one
 * `X-Forwarded-For` header (pinned by a test in `bootstrap.spec.ts`). That is
 * inert for the rate limiter locally and correct in the deployed environments
 * measured above, but a new ingress (another host, a second public path, a
 * proxy in front of the balancer) would need this re-measured, not inherited. Trusting by address range instead of a
 * count would remove the assumption entirely — considered in #1341. Until then
 * `createProxyChainTripwire` reports the first deployed request whose chain is
 * shorter than the count, which is how a stale count shows itself.
 *
 * `local` has no proxy, so any count over-trusts there. It carries staging's
 * figure so the suite exercises the resolution staging runs.
 */
export const TRUST_PROXY_HOPS: Readonly<Record<DeploymentEnvironment, number>> =
  {
    production: 2,
    staging: 2,
    local: 2,
  };

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
 * `docs/security/security-fixes.md`) — rather than add an
 * `'unsafe-inline'` `script-src` exception Swagger never needed, which would
 * have weakened XSS protection on every route, not just `/docs`.
 *
 * The one directive this API does override: Helmet's default
 * `Cross-Origin-Resource-Policy` is `same-origin`, which Chrome/Firefox
 * enforce independently of CORS. The dashboard is deliberately cross-origin
 * from this API (`corsOptionsFor` / `enableCors()` in `configureApp` allowlists
 * each deployment's exact dashboard origin, with `credentials: true`) — left at
 * the default, every dashboard `fetch()` response body would be silently
 * blocked client-side
 * even with a matching `Access-Control-Allow-Origin`. `'cross-origin'` is
 * correct here because the actual authorization boundary is CORS plus bearer
 * auth, not this header.
 */
const HELMET_OPTIONS = {
  crossOriginResourcePolicy: { policy: 'cross-origin' },
} as const;

/**
 * The largest JSON body the API reads, on every route but the ones below:
 * Express's own default, stated so it reads as a choice. Each DTO still caps
 * its own fields; this is only the ceiling the parser enforces before any of
 * them is read, or any guard has run.
 */
const JSON_BODY_LIMIT = '100kb';

/**
 * The routes that take a larger body (#4504), and how large:
 *
 * - Meetings. A recording's transcript becomes an officer's notes (#712), and
 *   `MEETING_NOTES_MAX_LENGTH` is 160,000 characters, where a character can
 *   take three bytes; a full set of minutes (four 20,000-character sections
 *   and up to 200 items) can pass 100 KB too.
 * - AI reports. "Report this" on an Ask answer hands back the answer's sealed
 *   receipt, up to `AI_REPORT_RECEIPT_MAX_LENGTH` (200,000) characters.
 * - Discord imports. The web client confirms uploaded export files 500 paths
 *   at a time (`CONFIRM_BATCH`), each path around 200 bytes, and the channel
 *   map can list up to 1,000 channels: both pass 100 KB on a large server.
 * - A form card in chat, and a member's answers to one (#3926). A form within
 *   the `FORM_*` limits can carry 40 questions of 30 options at 200
 *   characters each, and its answers 40 paragraphs of 4,000, where a
 *   character can take three bytes. Only the send route and the answers
 *   route, not the rest of `/v1/channels`; `:id` matches one path segment,
 *   so a send's attachment routes under it share the ceiling.
 *
 * Every route under these prefixes needs a signed-in member. The parser runs
 * before the guards, so a caller with no token can still send these
 * prefixes a 1 MB body before the 401, but not the sign-in, invite and
 * webhook routes, nor any other. A new route that needs more than 100 KB is
 * added here, not by raising the general limit.
 */
const LARGE_JSON_BODY_LIMIT = '1mb';
export const LARGE_JSON_BODY_PATHS = [
  '/v1/meetings',
  '/v1/ai/reports',
  '/v1/discord-imports',
  '/v1/channels/:id/messages',
  '/v1/channels/messages/:messageId/form-response',
];

/**
 * `environment` defaults to this process's own (`NODE_ENV`). Tests pass one to
 * exercise another deployment's origins and hop count without mutating
 * `process.env`.
 */
export function configureApp(
  app: INestApplication,
  environment: DeploymentEnvironment = deploymentEnvironment(),
): void {
  // Before Helmet, matching the previous main.ts order: CORS preflight
  // must see the request before other middleware short-circuits OPTIONS.
  app.enableCors(corsOptionsFor(environment));

  // First of the remaining stack, so every response — success, error, or a
  // guard rejection before any handler runs — carries the same security
  // headers.
  app.use(helmet(HELMET_OPTIONS));

  // Behind Render, Express must resolve the caller from `X-Forwarded-For`, or
  // `req.ip` is the proxy's address and every unauthenticated caller shares one
  // rate-limit bucket (`custom-throttler.guard.ts` falls back to `ip:` keying)
  // and one `originHash` (#864). It lives here rather than in `main.ts` so the
  // e2e suite runs under the same resolution production does — the #1020 gap
  // this whole function exists to close.
  const httpAdapter: { getInstance: () => unknown } = app.getHttpAdapter();
  const expressInstance = httpAdapter.getInstance() as ExpressSettable;
  const trustedHops = TRUST_PROXY_HOPS[environment];
  expressInstance.set('trust proxy', trustedHops);
  if (environment !== 'local') {
    app.use(createProxyChainTripwire(trustedHops));
  }

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  // Same ConsoleLogger format as Nest's default, with requestId on the
  // context; on Cloud Run, one JSON record per line for Cloud Logging. Lives
  // here so e2e and production share it — a copy in `main.ts` would leave the
  // suite asserting a logger production does not use.
  app.useLogger(
    new RequestContextLogger({ json: runsOnCloudRun(process.env) }),
  );

  // Before the Nest pipeline, so guard rejections carry a request id too — see
  // the middleware's own note on why this cannot be an interceptor.
  app.use(requestIdMiddleware);

  // Also before the guards, which make the first membership and role reads
  // the rest of the request shares (#3728). `RequestReadsInterceptor` below
  // ends that sharing at a write's handler.
  app.use(requestReadsMiddleware);

  // Here, not in `main.ts`, so the e2e suite parses bodies as production does.
  // After the request id: these register at once, and a body they refuse
  // (malformed, or over the limit) must still answer with an id. The larger
  // parser goes first; a body it has read is marked read, and the general
  // parser after it passes over that request.
  app.use(LARGE_JSON_BODY_PATHS, json({ limit: LARGE_JSON_BODY_LIMIT }));
  (app as NestExpressApplication).useBodyParser('json', {
    limit: JSON_BODY_LIMIT,
  });
  // Nest's own form parser, registered here rather than left to `init()`,
  // which adds it after everything below (it skips a parser by this name that
  // is already in place). Same options as Nest's default.
  (app as NestExpressApplication).useBodyParser('urlencoded', {
    extended: true,
  });
  // After every parser: their refusals answer 4xx with a fixed message, not
  // 500 or the parser's own text (#4404).
  app.use(bodyParserErrorMiddleware);

  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new RequestReadsInterceptor(),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Nest calls AnalyticsModule.onModuleDestroy so the PostHog client can
  // flush/retry/drop on SIGTERM. Without this, Render SIGTERM skips it.
  app.enableShutdownHooks();
}
