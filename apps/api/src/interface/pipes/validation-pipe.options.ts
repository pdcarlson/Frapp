import {
  BadRequestException,
  ValidationPipe,
  type ValidationError,
  ValidationPipeOptions,
} from '@nestjs/common';
import { REQUEST_VALIDATION_FAILED_CODE } from '@repo/validation';

/**
 * Nest's own refusal builder, as a `ValidationPipe` with no options of its own
 * builds it: the 400, its field messages flattened, and the length budget on
 * them. Built once; it holds no per-request state.
 */
const nestRefusal = new ValidationPipe().createExceptionFactory();

/**
 * Nest's refusal with the API's machine code added, so a client can tell a
 * request its DTO refused from a 400 a service throws over what a member did
 * (#4096). A correct client never sends what its DTO refuses, so the clients'
 * query-error reporters send this code to Sentry as a bug
 * (`@repo/observability`'s `api-error-codes.ts`). Anything that isn't Nest's
 * plain 400 body is passed on unchanged.
 */
function codedValidationRefusal(errors: ValidationError[]): unknown {
  const refusal = nestRefusal(errors);
  if (!(refusal instanceof BadRequestException)) return refusal;
  const body = refusal.getResponse();
  if (typeof body !== 'object' || body === null) return refusal;
  return new BadRequestException({
    ...body,
    code: REQUEST_VALIDATION_FAILED_CODE,
  });
}

/**
 * The global request-validation contract, in one place.
 *
 * `whitelist` strips properties no DTO declares; `forbidNonWhitelisted` turns
 * that strip into a 400 so an unexpected property is rejected outright rather
 * than silently dropped. Together they are what stops a client from posting
 * `role`, `points`, or `chapter_id` into a write it does not own (#849).
 * `exceptionFactory` is {@link codedValidationRefusal}: every refusal carries
 * `code: request.validation_failed`.
 *
 * This lives in its own module rather than inline in `configureApp()`
 * (`bootstrap.ts`) for the same reason `buildSentryOptions` does: a test that
 * rebuilds these flags locally is testing its own copy, and stays green when
 * production's copy is loosened. `test/mass-assignment.e2e-spec.ts` boots
 * through `configureApp()`, so it is the suite that fails when `whitelist` or
 * `forbidNonWhitelisted` is loosened. The DTO specs that run a pipe build it
 * from this object too, so they validate as production does, but they send no
 * undeclared property, so they pin neither `whitelist` nor
 * `forbidNonWhitelisted`.
 */
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  exceptionFactory: codedValidationRefusal,
};
