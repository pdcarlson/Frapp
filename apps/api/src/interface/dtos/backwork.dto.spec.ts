import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { MAX_BACKWORK_ZIP_FILES } from '@repo/validation';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import {
  BackworkDownloadUrlsQueryDto,
  UpdateBackworkDraftsDto,
} from './backwork.dto';

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

  it('lowercases and drops repeats', async () => {
    await expect(
      transform({ ids: `${id(1).toUpperCase()},${id(1)},${id(2)}` }),
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

describe('UpdateBackworkDraftsDto', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: UpdateBackworkDraftsDto,
    data: '',
  };
  const transform = (body: unknown) => pipe.transform(body, metadata);
  const ids = ['3f0c1d9e-0000-4000-8000-000000000001'];

  it('takes a field to set, or null to clear one', async () => {
    await expect(
      transform({ ids, fields: { semester: 'Fall', year: null } }),
    ).resolves.toMatchObject({ ids, fields: { semester: 'Fall', year: null } });
  });

  it.each([{ ids }, { ids, fields: null }, { ids, fields: 'Fall' }])(
    'refuses %j instead of failing later',
    async (body) => {
      await expect(transform(body)).rejects.toThrow(BadRequestException);
    },
  );
});
