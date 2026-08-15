import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './interface/filters/all-exceptions.filter';
import { requestIdMiddleware } from './interface/middleware/request-id.middleware';
import { VALIDATION_PIPE_OPTIONS } from './interface/pipes/validation-pipe.options';
import { LoggingInterceptor } from './interface/interceptors/logging.interceptor';
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

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3002',
      /^https:\/\/(?:[a-zA-Z0-9-]+\.)*frapp\.live$/,
    ],
    credentials: true,
    // Only the seven CORS-safelisted response headers reach browser JS unless
    // they are named here. The dashboard is cross-origin by design
    // (api.frapp.live vs app.frapp.live), so without this the report
    // truncation flags are set by the API, stripped by the browser, and a
    // short report looks complete to the one caller most likely to email it
    // onward. See spec/behavior/reports.md § Row limits.
    exposedHeaders: [
      'X-Report-Truncated',
      'X-Report-Row-Limit',
      'X-Report-Truncation-Note',
    ],
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  // Before the Nest pipeline, so guard rejections carry a request id too — see
  // the middleware's own note on why this cannot be an interceptor.
  app.use(requestIdMiddleware);

  app.useGlobalInterceptors(new LoggingInterceptor());

  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Frapp API')
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
  Logger.log(`Frapp API running on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Swagger docs at http://localhost:${port}/docs`, 'Bootstrap');
}

void bootstrap();
