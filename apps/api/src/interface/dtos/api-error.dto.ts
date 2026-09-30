import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The body of every error response the API sends. `AllExceptionsFilter` is
 * the only writer and types its body as this class, so the document and the
 * wire can't drift apart without a type error. `buildOpenApiConfig` attaches
 * it to every operation as the `default` response, which is how the generated
 * SDK types the `error` of each call.
 *
 * The contract, including when `code` is present: `spec/architecture/README.md`
 * § 10 (Error responses).
 */
export class ApiErrorResponseDto {
  @ApiProperty({ description: 'The HTTP status, repeated.', example: 403 })
  statusCode: number;

  @ApiProperty({
    description: "The status's `HttpStatus` name.",
    example: 'FORBIDDEN',
  })
  error: string;

  @ApiProperty({
    description:
      'Human-readable explanation. The validation pipe sends one entry per failed field.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'You are not a member of the requested chapter.',
  })
  message: string | string[];

  @ApiProperty({
    description: 'The `x-request-id` this request was logged under.',
    example: 'req_3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f',
  })
  requestId: string;

  @ApiPropertyOptional({
    description:
      'Stable, machine-readable reason for the refusal. Present only when the refusal has one; branch on it rather than on `message`.',
    example: 'chapter.context.invalid',
  })
  code?: string;
}
