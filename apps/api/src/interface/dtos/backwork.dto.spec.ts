import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { MAX_BACKWORK_ZIP_FILES } from '@repo/validation';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { BackworkDownloadUrlsQueryDto } from './backwork.dto';

/**
 * The zip's id list arrives as a query string. Run through the production
 * pipe options, so the comma split and the file cap are what a request gets.
 */
describe('BackworkDownloadUrlsQueryDto', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: BackworkDownloadUrlsQueryDto,
    data: '',
  };
  const transform = (query: unknown) => pipe.transform(query, metadata);
  const id = (n: number) =>
    `3f0c1d9e-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('splits a comma-separated list', async () => {
    await expect(
      transform({ ids: `${id(1)}, ${id(2)}` }),
    ).resolves.toMatchObject({ ids: [id(1), id(2)] });
  });

  it('takes the key repeated', async () => {
    await expect(transform({ ids: [id(1), id(2)] })).resolves.toMatchObject({
      ids: [id(1), id(2)],
    });
  });

  it(`refuses more than ${MAX_BACKWORK_ZIP_FILES} ids`, async () => {
    const ids = Array.from({ length: MAX_BACKWORK_ZIP_FILES + 1 }, (_, n) =>
      id(n),
    ).join(',');
    await expect(transform({ ids })).rejects.toThrow(BadRequestException);
  });

  it.each([{}, { ids: '' }, { ids: 'not-a-uuid' }])(
    'refuses %j',
    async (query) => {
      await expect(transform(query)).rejects.toThrow(BadRequestException);
    },
  );
});
