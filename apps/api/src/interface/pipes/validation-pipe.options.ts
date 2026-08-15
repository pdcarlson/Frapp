import { ValidationPipeOptions } from '@nestjs/common';

/**
 * The global request-validation contract, in one place.
 *
 * `whitelist` strips properties no DTO declares; `forbidNonWhitelisted` turns
 * that strip into a 400 so an unexpected property is rejected outright rather
 * than silently dropped. Together they are what stops a client from posting
 * `role`, `points`, or `chapter_id` into a write it does not own (#849).
 *
 * This lives beside `main.ts` rather than inside it for the same reason
 * `buildSentryOptions` does: a test that rebuilds these flags locally is
 * testing its own copy, and stays green when production's copy is loosened.
 * `test/mass-assignment.e2e-spec.ts` imports this object so that loosening a
 * flag here fails that suite.
 */
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
};
