// First import: Sentry Node OTEL patches Nest/HTTP before other modules load.
import './instrument';
import { NestFactory } from '@nestjs/core';
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

/**
 * A rejected `bootstrap()` used to surface as Node's generic unhandled-rejection
 * notice — "This error originated either by throwing inside of an async function
 * without a catch block…" — with the real reason trailing behind it. Render's
 * deploy log for `dep-daka00vqj5pc73acul20` is what that looks like when the
 * cause is a refused config check: the boot guard did its job, and the operator
 * had to read past a paragraph about promises to find out which variable was
 * wrong. Catch it, print the reason first, and exit non-zero deliberately.
 */
bootstrap().catch((error: unknown) => {
  const reason =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  Logger.error(`API failed to start: ${reason}`, 'Bootstrap');
  process.exit(1);
});
