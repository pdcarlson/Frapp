import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'], // Detailed logging
  });

  // Security: Enable CORS for our frontend/mobile apps
  app.enableCors();

  // API Versioning (e.g., /v1/health)
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger Documentation
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
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}/v1`);
  console.log(`📖 Documentation: http://localhost:${port}/docs`);
}
void bootstrap();
