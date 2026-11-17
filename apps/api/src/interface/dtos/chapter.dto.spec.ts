import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import {
  CHAPTER_NAME_MAX_LENGTH,
  CHAPTER_UNIVERSITY_MAX_LENGTH,
} from '@repo/validation';
import { UpdateChapterDto } from './chapter.dto';

const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

function transform(body: Record<string, unknown>) {
  return pipe.transform(body, { type: 'body', metatype: UpdateChapterDto });
}

/**
 * The chapter profile save (`PATCH /v1/chapters/current`): name and
 * university are trimmed and bounded by the onboarding wizard's rule
 * (`ChapterNameRules`, `ChapterUniversityRules`).
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

  it('takes the shortest the wizard takes', async () => {
    await expect(transform({ name: 'ΣΦΕ', university: 'MU' })).resolves.toEqual(
      { name: 'ΣΦΕ', university: 'MU' },
    );
  });

  it.each([
    { name: '' },
    { name: '   ' },
    { name: ' ab ' },
    { university: ' U ' },
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

describe('UpdateChapterDto — the refusal a member reads', () => {
  async function messageFor(body: Record<string, unknown>) {
    const error: unknown = await transform(body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: string[] }
    ).message;
  }

  it('says how short and how long each may be, in the wizard words', async () => {
    expect(await messageFor({ name: '  ' })).toEqual([
      "Use at least 3 characters for the chapter's name.",
    ]);
    expect(await messageFor({ university: 'u'.repeat(201) })).toEqual([
      'Keep the university to 200 characters or fewer.',
    ]);
  });
});
