import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

// Allow export without real env vars (only used to build Swagger doc)
if (!process.env.SUPABASE_URL)
  process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-key';
if (!process.env.STRIPE_SECRET_KEY)
  process.env.STRIPE_SECRET_KEY = 'openapi_export_stub'; // pragma: allowlist secret
if (!process.env.STRIPE_WEBHOOK_SECRET)
  process.env.STRIPE_WEBHOOK_SECRET = 'openapi_export_stub'; // pragma: allowlist secret
if (!process.env.STRIPE_PRICE_ID)
  process.env.STRIPE_PRICE_ID = 'openapi_export_stub'; // pragma: allowlist secret

async function exportOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const config = new DocumentBuilder()
    .setTitle('Frapp API')
    .setDescription('The Operating System for Greek Life')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey(
      { type: 'apiKey', name: 'x-chapter-id', in: 'header' },
      'chapter-id',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outPath = join(__dirname, '..', 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2), 'utf-8');
  console.log(`Wrote ${outPath}`);
  await app.close();
}

exportOpenApi().catch((err) => {
  console.error(err);
  process.exit(1);
});
