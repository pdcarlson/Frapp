import { PRODUCTION_SUPABASE_PROJECT_REF } from '@repo/validation';
import { aiProviderMode, isAiEnabled, validateAiEnv } from './ai-config';

describe('isAiEnabled', () => {
  it('is on only for exactly "true"', () => {
    expect(isAiEnabled({ AI_ENABLED: 'true' })).toBe(true);
  });

  it.each([undefined, '', 'false', 'TRUE', '1', 'yes', true])(
    'is off for %p',
    (value) => {
      expect(isAiEnabled({ AI_ENABLED: value })).toBe(false);
    },
  );
});

describe('aiProviderMode', () => {
  it('is live unless scripted is asked for by name', () => {
    expect(aiProviderMode({})).toBe('live');
    expect(aiProviderMode({ AI_PROVIDER: 'live' })).toBe('live');
    expect(aiProviderMode({ AI_PROVIDER: 'Scripted' })).toBe('live');
    expect(aiProviderMode({ AI_PROVIDER: 'scripted' })).toBe('scripted');
  });
});

describe('validateAiEnv', () => {
  it('accepts an environment that sets nothing', () => {
    expect(validateAiEnv({})).toEqual([]);
    expect(validateAiEnv({ AI_ENABLED: '', AI_PROVIDER: '' })).toEqual([]);
  });

  it('accepts the documented values', () => {
    expect(
      validateAiEnv({ AI_ENABLED: 'true', AI_PROVIDER: 'scripted' }),
    ).toEqual([]);
    expect(validateAiEnv({ AI_ENABLED: 'false', AI_PROVIDER: 'live' })).toEqual(
      [],
    );
  });

  it('refuses a typo instead of reading it as off', () => {
    expect(validateAiEnv({ AI_ENABLED: 'yes' })).toEqual([
      'AI_ENABLED must be "true" or "false" when set.',
    ]);
    expect(validateAiEnv({ AI_PROVIDER: 'fake' })).toEqual([
      'AI_PROVIDER must be "live" or "scripted" when set.',
    ]);
  });

  // Canned replies must never be shown to a real chapter as a model's work.
  it('refuses the scripted adapter against the production database', () => {
    const production = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
    expect(
      validateAiEnv({ AI_PROVIDER: 'scripted', SUPABASE_URL: production }),
    ).toHaveLength(1);
    expect(
      validateAiEnv({ AI_PROVIDER: 'live', SUPABASE_URL: production }),
    ).toEqual([]);
    expect(
      validateAiEnv({
        AI_PROVIDER: 'scripted',
        SUPABASE_URL: 'http://127.0.0.1:54321',
      }),
    ).toEqual([]);
  });
});
