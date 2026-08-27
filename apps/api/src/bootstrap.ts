import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
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
 * neither is meaningful against an in-memory test app.
 */
export function configureApp(app: INestApplication): void {
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  // Before the Nest pipeline, so guard rejections carry a request id too — see
  // the middleware's own note on why this cannot be an interceptor.
  app.use(requestIdMiddleware);

  app.useGlobalInterceptors(new LoggingInterceptor());

  app.useGlobalFilters(new AllExceptionsFilter());
}
