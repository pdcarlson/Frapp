import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { GRADUATION_YEAR_MAX, GRADUATION_YEAR_MIN } from '@repo/validation';
import { ConfirmAvatarDto, UpdateUserDto } from './user.dto';

const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

function transform(metatype: new () => object, body: Record<string, unknown>) {
  return pipe.transform(body, { type: 'body', metatype });
}

describe('UpdateUserDto', () => {
  it('still accepts the text fields', async () => {
    await expect(
      transform(UpdateUserDto, { display_name: 'Ann', bio: 'Hi' }),
    ).resolves.toEqual({ display_name: 'Ann', bio: 'Hi' });
  });

  // The shared bound both clients refuse before sending (#3387).
  it.each([GRADUATION_YEAR_MIN, GRADUATION_YEAR_MAX, null])(
    'accepts graduation_year %s',
    async (graduation_year) => {
      await expect(
        transform(UpdateUserDto, { graduation_year }),
      ).resolves.toEqual({ graduation_year });
    },
  );

  it.each([GRADUATION_YEAR_MIN - 1, GRADUATION_YEAR_MAX + 1, 2027.5])(
    'refuses graduation_year %s',
    async (graduation_year) => {
      await expect(
        transform(UpdateUserDto, { graduation_year }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  // #2519: a free-text avatar_url let a member point their photo at any
  // string, including another member's storage path. The photo is now set
  // only by confirming an upload.
  it.each([
    'chapters/ch-1/profiles/someone-else/p.jpg',
    'https://example.com/p.jpg',
  ])('refuses avatar_url (%s)', async (avatar_url) => {
    await expect(
      transform(UpdateUserDto, { avatar_url }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ConfirmAvatarDto', () => {
  it('requires storage_path', async () => {
    await expect(transform(ConfirmAvatarDto, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
