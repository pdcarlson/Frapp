import { NestFactory } from '@nestjs/core';
import { VersioningType, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

// Allow export without real env vars (only used to build Swagger doc)
if (!process.env.SUPABASE_URL)
  process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-key';
if (!process.env.SUPABASE_ANON_KEY)
  process.env.SUPABASE_ANON_KEY = 'placeholder-anon-key';
const requiredEnvVars = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID',
];

const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  throw new Error(
    `Missing required environment variables for OpenAPI export: ${missingVars.join(', ')}`,
  );
}

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
  Logger.log(`Wrote ${outPath}`, 'OpenAPIExport');
  await app.close();
}

exportOpenApi().catch((err) => {
  Logger.error(err, 'OpenAPIExport');
  process.exit(1);
});
