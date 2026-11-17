import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import {
  CHAPTER_NAME_MAX_LENGTH,
  CHAPTER_UNIVERSITY_MAX_LENGTH,
} from '#domain/constants/field-limits';
import { UpdateChapterDto } from './chapter.dto';

const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

function transform(body: Record<string, unknown>) {
  return pipe.transform(body, { type: 'body', metatype: UpdateChapterDto });
}

/**
 * The chapter profile save (`PATCH /v1/chapters/current`): name and
 * university are trimmed, never blank, and bounded, as on the onboarding
 * wizard's create.
 */
describe('UpdateChapterDto — name and university', () => {
  it('trims both, and leaves out what was not sent', async () => {
    await expect(
      transform({ name: ' Tau Nu ', university: ' RPI ' }),
    ).resolves.toEqual({ name: 'Tau Nu', university: 'RPI' });
    await expect(transform({ donation_url: undefined })).resolves.toEqual({});
  });

  it('takes each at its limit', async () => {
    const body = {
      name: 'n'.repeat(CHAPTER_NAME_MAX_LENGTH),
      university: 'u'.repeat(CHAPTER_UNIVERSITY_MAX_LENGTH),
    };
    await expect(transform(body)).resolves.toEqual(body);
  });

  it.each([
    { name: '' },
    { name: '   ' },
    // NOT NULL in the database: a null must be a 400, not a 500.
    { name: null },
    { name: 'n'.repeat(CHAPTER_NAME_MAX_LENGTH + 1) },
    { university: '  ' },
    { university: null },
    { university: 'u'.repeat(CHAPTER_UNIVERSITY_MAX_LENGTH + 1) },
  ])('refuses %o', async (body) => {
    await expect(transform(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
