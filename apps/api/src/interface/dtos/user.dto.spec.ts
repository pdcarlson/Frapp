import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
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
