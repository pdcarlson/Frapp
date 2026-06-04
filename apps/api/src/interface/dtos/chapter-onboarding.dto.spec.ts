import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChapterOnboardingDto } from './chapter-onboarding.dto';

/** Validate a plain payload through the DTO and return the failing property names. */
async function failingProps(
  payload: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(ChapterOnboardingDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('ChapterOnboardingDto — Terms/Privacy acceptance gate (FRA-17)', () => {
  const base = { name: 'Sigma Phi Epsilon', university: 'UCLA' };

  it('accepts a payload where accept_terms_privacy is true', async () => {
    expect(
      await failingProps({ ...base, accept_terms_privacy: true }),
    ).not.toContain('accept_terms_privacy');
  });

  it('rejects accept_terms_privacy: false (@Equals(true) is the server-side legal gate)', async () => {
    expect(
      await failingProps({ ...base, accept_terms_privacy: false }),
    ).toContain('accept_terms_privacy');
  });

  it('rejects a missing accept_terms_privacy', async () => {
    expect(await failingProps(base)).toContain('accept_terms_privacy');
  });
});
