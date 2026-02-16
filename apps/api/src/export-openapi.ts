import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as fs from 'fs';
import * as path from 'path';

async function generateOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Frapp API')
    .setDescription('The Operating System for Greek Life - Backend API')
    .setVersion('1.0')
    .addTag('frapp')
    .addBearerAuth()
    .addGlobalParameters({
      name: 'x-chapter-id',
      in: 'header',
      description: 'The Chapter ID for multi-tenancy',
      required: false,
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outputPath = path.resolve(__dirname, '../openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));

  console.log(`✅ OpenAPI specification exported to ${outputPath}`);
  await app.close();
  process.exit(0);
}

void generateOpenApi();
