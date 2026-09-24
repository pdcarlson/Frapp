// First import: Sentry Node OTEL patches Nest/HTTP before other modules load.
import './instrument';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  // CORS lives in configureApp (CORS_OPTIONS) so the e2e harness sees the
  // same Access-Control-Expose-Headers list production ships — including
  // x-request-id. See bootstrap.ts.
  configureApp(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Frapp API')
    .setDescription(
      'The HTTP API behind the Frapp mobile app and web dashboard.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey(
      { type: 'apiKey', name: 'x-chapter-id', in: 'header' },
      'chapter-id',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  Logger.log(`Frapp API running on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Swagger docs at http://localhost:${port}/docs`, 'Bootstrap');
}

/**
 * A rejected `bootstrap()` used to surface as Node's generic unhandled-rejection
 * notice — "This error originated either by throwing inside of an async function
 * without a catch block…" — with the real reason trailing behind it. Render's
 * deploy log for `dep-daka00vqj5pc73acul20` is what that looks like when the
 * cause is a refused config check: the boot guard did its job, and the operator
 * had to read past a paragraph about promises to find out which variable was
 * wrong. Catch it and print the reason first.
 *
 * Capturing to Sentry EXPLICITLY is not belt-and-braces, it is the whole reason
 * this block is safe to add. `./instrument` is the first import in this file, so
 * Sentry is live before `bootstrap()` runs, and its default
 * `onUnhandledRejectionIntegration` was what reported a failed boot — routed per
 * `docs/internal/ops/ALERT_ROUTING.md`. Handling the rejection here means that
 * listener never fires. Without the two lines below, this change would trade a
 * paged alert for a prettier deploy log nobody is watching: strictly worse for
 * exactly the incident it was written for.
 *
 * `flush` is awaited before exiting because `process.exit` gives queued
 * transport work no chance to drain. It resolves harmlessly when no DSN is
 * configured, and its own failure must not replace the error being reported.
 */
bootstrap().catch(async (error: unknown) => {
  const reason =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  Logger.error(`API failed to start: ${reason}`, 'Bootstrap');
  try {
    Sentry.captureException(error, { level: 'fatal' });
    await Sentry.flush(2000);
  } catch (flushError) {
    Logger.error(
      `Sentry reporting of the boot failure itself failed: ${String(flushError)}`,
      'Bootstrap',
    );
  }
  process.exit(1);
});
