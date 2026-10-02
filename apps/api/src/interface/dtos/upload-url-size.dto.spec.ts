import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { RequestBackworkUploadUrlDto } from './backwork.dto';
import { RequestDocumentUploadUrlDto } from './chapter-document.dto';
import { RequestChatUploadUrlDto } from './chat.dto';
import { RequestProofUploadUrlDto } from './service-entry.dto';
import { RequestAvatarUploadUrlDto } from './user.dto';

/**
 * `size_bytes` on the five upload-URL requests (#2913). `@IsOptional` skips
 * `null` as well as `undefined`, so `{"size_bytes": null}` used to pass the
 * pipe and reach the service's ceiling check, which answered "File exceeds the
 * 25 MB upload limit" for a file of no stated size. Omitting the field is how a
 * client says it doesn't know; `null` is now refused as not an integer.
 *
 * Run through the real pipe options, as `bootstrap.ts` registers them.
 */
describe.each([
  ['RequestBackworkUploadUrlDto', RequestBackworkUploadUrlDto],
  ['RequestDocumentUploadUrlDto', RequestDocumentUploadUrlDto],
  ['RequestChatUploadUrlDto', RequestChatUploadUrlDto],
  ['RequestProofUploadUrlDto', RequestProofUploadUrlDto],
  ['RequestAvatarUploadUrlDto', RequestAvatarUploadUrlDto],
])('%s size_bytes (#2913)', (_name, metatype) => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const metadata: ArgumentMetadata = { type: 'body', metatype };
  const transform = (payload: unknown) => pipe.transform(payload, metadata);
  const base = { filename: 'notes.pdf', content_type: 'application/pdf' };

  it('accepts a request that omits it', async () => {
    await expect(transform(base)).resolves.toEqual(
      expect.not.objectContaining({ size_bytes: expect.anything() }),
    );
  });

  it('accepts a size', async () => {
    await expect(transform({ ...base, size_bytes: 2048 })).resolves.toEqual(
      expect.objectContaining({ size_bytes: 2048 }),
    );
  });

  it('refuses null as not an integer, rather than as too large', async () => {
    const error = await transform({ ...base, size_bytes: null }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(
      JSON.stringify((error as BadRequestException).getResponse()),
    ).toMatch(/size_bytes must be an integer/);
  });
});
