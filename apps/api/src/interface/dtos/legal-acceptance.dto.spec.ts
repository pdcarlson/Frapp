import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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
