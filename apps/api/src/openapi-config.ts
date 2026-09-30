import { DocumentBuilder, type OpenAPIObject } from '@nestjs/swagger';
import { ApiErrorResponseDto } from './interface/dtos/api-error.dto';

/**
 * The OpenAPI document's header: title, description, version, the two
 * security schemes, and the error body every operation can return. One list
 * with two callers, like `configureApp`: `main.ts` serves it at `/docs`, and
 * `export-openapi.ts` writes it into the committed `openapi.json` that the SDK
 * is generated from. Two hand-kept copies of this chain could drift, and CI
 * builds only the exported one.
 *
 * The error body is a `default` response rather than per-status entries
 * because `AllExceptionsFilter` sends the same shape for every status, and
 * `openapi-fetch` types a `default` response as the call's `error`.
 * `addGlobalResponse` writes to a process-wide store that `createDocument`
 * reads, so it applies only when this runs before that call, as it does in
 * both entry points.
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
    .addGlobalResponse({
      status: 'default',
      description: 'Error',
      type: ApiErrorResponseDto,
    })
    .build();
}
