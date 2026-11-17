import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import {
  DISPLAY_NAME_MAX_LENGTH,
  GRADUATION_YEAR_MAX,
  GRADUATION_YEAR_MIN,
  MAJOR_MAX_LENGTH,
  USER_BIO_MAX_LENGTH,
  USER_CITY_MAX_LENGTH,
  USER_COMPANY_MAX_LENGTH,
} from '@repo/validation';
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

  // #3711: the member's own phone, trimmed; blank clears it.
  it('accepts a phone number as typed, trimmed', async () => {
    await expect(
      transform(UpdateUserDto, { phone: ' (518) 555-0142 ' }),
    ).resolves.toEqual({ phone: '(518) 555-0142' });
  });

  it.each(['', '   ', null])('clears the phone for %j', async (phone) => {
    await expect(transform(UpdateUserDto, { phone })).resolves.toEqual({
      phone: null,
    });
  });

  it.each(['call me', '555-01', '+1 (518) 555-0142 ext 12345678'])(
    'refuses phone %j',
    async (phone) => {
      await expect(transform(UpdateUserDto, { phone })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('accepts a major up to the shared limit, and refuses one past it', async () => {
    const major = 'M'.repeat(MAJOR_MAX_LENGTH);
    await expect(transform(UpdateUserDto, { major })).resolves.toEqual({
      major,
    });
    await expect(
      transform(UpdateUserDto, { major: `${major}M` }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // The same name rule as an officer's correction (`CorrectMemberProfileDto`).
  it('trims the name, and takes one at the shared limit', async () => {
    await expect(
      transform(UpdateUserDto, { display_name: '  Ann Lee ' }),
    ).resolves.toEqual({ display_name: 'Ann Lee' });
    const display_name = 'N'.repeat(DISPLAY_NAME_MAX_LENGTH);
    await expect(transform(UpdateUserDto, { display_name })).resolves.toEqual({
      display_name,
    });
  });

  it.each([
    ['', 'Enter a name.'],
    ['   ', 'Enter a name.'],
    [null, 'display_name must be a string'],
    ['N'.repeat(DISPLAY_NAME_MAX_LENGTH + 1), 'Keep your name to'],
  ])('refuses the name %j', async (display_name, message) => {
    const error: unknown = await transform(UpdateUserDto, {
      display_name,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(
      JSON.stringify((error as BadRequestException).getResponse()),
    ).toContain(message);
  });

  it.each([
    ['bio', USER_BIO_MAX_LENGTH],
    ['current_city', USER_CITY_MAX_LENGTH],
    ['current_company', USER_COMPANY_MAX_LENGTH],
  ] as const)(
    'takes %s empty (clearing it) and at its limit, and refuses one past it',
    async (field, max) => {
      await expect(transform(UpdateUserDto, { [field]: '' })).resolves.toEqual({
        [field]: '',
      });
      const value = 'x'.repeat(max);
      await expect(
        transform(UpdateUserDto, { [field]: value }),
      ).resolves.toEqual({ [field]: value });
      await expect(
        transform(UpdateUserDto, { [field]: `${value}x` }),
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

describe('UpdateUserDto birthday (#4959)', () => {
  it('accepts a month, day, year and who sees it, and nulls that clear them', async () => {
    const body = {
      birthday_month: 2,
      birthday_day: 29,
      birthday_year: 2004,
      birthday_visibility: 'chapter',
    };
    await expect(transform(UpdateUserDto, body)).resolves.toEqual(body);
    const cleared = {
      birthday_month: null,
      birthday_day: null,
      birthday_year: null,
    };
    await expect(transform(UpdateUserDto, cleared)).resolves.toEqual(cleared);
  });

  it.each([
    { birthday_month: 0 },
    { birthday_month: 13 },
    { birthday_month: 2.5 },
    { birthday_day: 0 },
    { birthday_day: 32 },
    { birthday_year: 1899 },
    { birthday_year: 2004.5 },
    { birthday_visibility: 'everyone' },
    // NOT NULL in the database: a null must be a 400, not a 500.
    { birthday_visibility: null },
  ])('refuses %o', async (body) => {
    await expect(transform(UpdateUserDto, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ConfirmAvatarDto', () => {
  it('requires storage_path', async () => {
    await expect(transform(ConfirmAvatarDto, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
