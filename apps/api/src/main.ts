import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { buildSentryOptions } from './infrastructure/observability/sentry-options';
import { pseudonymsAvailable } from './infrastructure/observability/pseudonyms';

function initializeSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // No DSN → no-op, in every environment. This is the switch that keeps
    // local and test runs from reporting anywhere.
    return;
  }

  if (!pseudonymsAvailable()) {
    // Without the salt, `beforeSend` cannot pseudonymize — it would strip the
    // identifiers instead, and every event would arrive unattributable.
    // `spec/behavior/observability.md` requires the hashes, so warn loudly
    // rather than let a misconfigured environment look healthy.
    Logger.warn(
      'SENTRY_DSN is set but ANALYTICS_HMAC_SALT is not — events will be ' +
        'reported with identifiers removed rather than pseudonymized. Set ' +
        'ANALYTICS_HMAC_SALT to make Sentry events attributable.',
      'Bootstrap',
    );
  }

  // Built in `sentry-options.ts` so the integration spec can assert against the
  // real configuration instead of a copy — see that file's note.
  Sentry.init(buildSentryOptions(dsn));
}

async function bootstrap() {
  initializeSentry();

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  // CORS lives in configureApp (CORS_OPTIONS) so the e2e harness sees the
  // same Access-Control-Expose-Headers list production ships — including
  // x-request-id. See bootstrap.ts.
  configureApp(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Signet API')
    .setDescription('The Operating System for Greek Life')
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
  Logger.log(`Signet API running on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Swagger docs at http://localhost:${port}/docs`, 'Bootstrap');
}

void bootstrap();
