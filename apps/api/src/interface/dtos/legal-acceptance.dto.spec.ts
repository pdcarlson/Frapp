import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { ChapterOnboardingDto } from './chapter-onboarding.dto';
import { CreateDiscordImportDto } from './discord-import.dto';
import { RedeemInviteDto } from './invite.dto';
import { AcceptLegalTermsDto } from './user.dto';

/** Validate a plain payload through a DTO and return the failing property names. */
async function failingProps(
  cls: new () => object,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, payload));
  return errors.map((e) => e.property);
}

describe('AcceptLegalTermsDto — the per-user acceptance gate (#2302)', () => {
  it('accepts accept_terms_privacy: true', async () => {
    expect(
      await failingProps(AcceptLegalTermsDto, { accept_terms_privacy: true }),
    ).toEqual([]);
  });

  it('rejects accept_terms_privacy: false', async () => {
    expect(
      await failingProps(AcceptLegalTermsDto, { accept_terms_privacy: false }),
    ).toContain('accept_terms_privacy');
  });

  it('rejects a missing accept_terms_privacy', async () => {
    expect(await failingProps(AcceptLegalTermsDto, {})).toContain(
      'accept_terms_privacy',
    );
  });
});

describe('RedeemInviteDto — the join checkbox (#2302)', () => {
  it('accepts a redeem without the checkbox (a user who already accepted)', async () => {
    expect(await failingProps(RedeemInviteDto, { token: 't' })).toEqual([]);
  });

  it('accepts a ticked checkbox', async () => {
    expect(
      await failingProps(RedeemInviteDto, {
        token: 't',
        accept_terms_privacy: true,
      }),
    ).toEqual([]);
  });

  it('rejects an explicit false rather than reading it as "not sent"', async () => {
    expect(
      await failingProps(RedeemInviteDto, {
        token: 't',
        accept_terms_privacy: false,
      }),
    ).toContain('accept_terms_privacy');
  });
});

/**
 * Through the production pipe, not bare `plainToInstance`. The global pipe
 * sets `enableImplicitConversion`, which turns a `boolean` field's `"false"`
 * into `true`; without `RawValue` these would all be recorded as consent.
 * Verified by removing `@RawValue()`: every string case below then resolves.
 */
describe('the Terms checkbox takes only a real boolean (#2302)', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const transform = (metatype: ArgumentMetadata['metatype'], value: object) =>
    pipe.transform(value, { type: 'body', metatype });

  const cases: Array<[string, ArgumentMetadata['metatype'], object]> = [
    ['POST /v1/users/me/legal-acceptance', AcceptLegalTermsDto, {}],
    ['POST /v1/invites/redeem', RedeemInviteDto, { token: 't' }],
    [
      'chapter onboarding',
      ChapterOnboardingDto,
      { name: 'Sigma Phi Epsilon', university: 'UCLA' },
    ],
  ];

  it.each(['false', 'true'])(
    "the Discord import's consent refuses the string %p too",
    async (value) => {
      await expect(
        transform(CreateDiscordImportDto, { consent_acknowledged: value }),
      ).rejects.toThrow();
    },
  );

  describe.each(cases)('%s', (_route, metatype, base) => {
    it.each(['false', 'true', 'no', '1'])(
      'refuses the string %p',
      async (value) => {
        await expect(
          transform(metatype, { ...base, accept_terms_privacy: value }),
        ).rejects.toThrow();
      },
    );

    it('refuses 1', async () => {
      await expect(
        transform(metatype, { ...base, accept_terms_privacy: 1 }),
      ).rejects.toThrow();
    });

    it('accepts true', async () => {
      await expect(
        transform(metatype, { ...base, accept_terms_privacy: true }),
      ).resolves.toEqual(
        expect.objectContaining({ accept_terms_privacy: true }),
      );
    });
  });
});
