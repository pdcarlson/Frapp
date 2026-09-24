import { DocumentBuilder, type OpenAPIObject } from '@nestjs/swagger';

/**
 * The OpenAPI document's header: title, description, version and the two
 * security schemes. One list with two callers, like `configureApp`:
 * `main.ts` serves it at `/docs`, and `export-openapi.ts` writes it into the
 * committed `openapi.json` that the SDK is generated from. Two hand-kept
 * copies of this chain could drift, and CI builds only the exported one.
 *
 * Reads no environment, so importing it early is safe in both entry points.
 */
export function buildOpenApiConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
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
}
