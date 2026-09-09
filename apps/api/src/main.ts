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

void bootstrap();
