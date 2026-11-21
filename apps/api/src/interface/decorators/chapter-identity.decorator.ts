import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  CHAPTER_NAME_MAX_LENGTH,
  CHAPTER_NAME_MIN_LENGTH,
  CHAPTER_UNIVERSITY_MAX_LENGTH,
  CHAPTER_UNIVERSITY_MIN_LENGTH,
  tooLongRefusal,
  tooShortRefusal,
} from '@repo/validation';
import { Trim } from './trim.decorator';

/**
 * One rule for a chapter's name and university, on onboarding's create
 * (`ChapterOnboardingDto`) and the Settings save (`UpdateChapterDto`), so a
 * name one route takes the other takes too. Each is trimmed before the length
 * checks, so spaces alone are refused as too short. Whether the field may be
 * left out is the DTO's.
 *
 * Each DTO states the minimum in its `@ApiProperty` description rather than
 * as `minLength`: the shipped-builds contract check reads a new `minLength`
 * as breaking, though onboarding has refused a shorter name since it shipped.
 */
function chapterText(subject: string, min: number, max: number) {
  return applyDecorators(
    Trim(),
    IsString(),
    MinLength(min, { message: tooShortRefusal(subject, min) }),
    MaxLength(max, { message: tooLongRefusal(subject, max) }),
  );
}

export function ChapterNameRules(): PropertyDecorator {
  return chapterText(
    "the chapter's name",
    CHAPTER_NAME_MIN_LENGTH,
    CHAPTER_NAME_MAX_LENGTH,
  );
}

export function ChapterUniversityRules(): PropertyDecorator {
  return chapterText(
    'the university',
    CHAPTER_UNIVERSITY_MIN_LENGTH,
    CHAPTER_UNIVERSITY_MAX_LENGTH,
  );
}
