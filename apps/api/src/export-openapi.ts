import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

// No Supabase placeholders here, deliberately: assigning to `process.env` in this
// file's body is always too late. `import { AppModule }` is hoisted above every
// statement below, so `ConfigModule.forRoot({ validate: validateEnv })` in
// app.module.ts has already read the environment by the time this line would run —
// verified by running the export with SUPABASE_URL unset and getting
// `Missing required environment variables: SUPABASE_URL` regardless. A caller that
// needs the export to run without real credentials must put them in the environment
// up front; scripts/check-api-contract-drift.mjs does exactly that, and says so.
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
  // `abortOnError: false` is what makes a bootstrap failure *visible*, and it
  // is not optional here. With the default `true`, Nest logs the reason through
  // the logger this call just disabled and then calls `process.exit(1)` itself
  // — the promise never rejects, so the `.catch` below never runs and the
  // script dies with exit 1 and zero output. Since `NestFactory.create` is the
  // only place the real DI container is built (unit tests supply their own
  // providers), that silence hides exactly the class of error this script is
  // best placed to catch: a service injecting something its module does not
  // provide, which would fail to boot in production.
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
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
  console.log(`[OpenAPIExport] wrote ${outPath}`);
  await app.close();
}

exportOpenApi().catch((err) => {
  // `console`, not `Logger`: the app is created with `logger: false`, which
  // disables Nest's logger process-wide — so the previous `Logger.error` here
  // printed nothing and this script failed with exit 1 and no output at all.
  // The failure it hides is the expensive kind: `NestFactory.create` bootstraps
  // the real container, so a missing provider surfaces here and nowhere else
  // (unit tests supply their own), and a silent exit 1 gives no clue which.
  console.error(
    '[OpenAPIExport] failed:',
    err instanceof Error ? err.stack : err,
  );
  process.exit(1);
});
