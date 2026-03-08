import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const createValidConfig = () => ({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    SUPABASE_ANON_KEY: 'anon-key',
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_123',
    STRIPE_PRICE_ID: 'price_123',
  });

  it('returns the same config when all required variables are present', () => {
    const config = createValidConfig();

    const result = validateEnv(config);

    expect(result).toBe(config);
  });

  it('throws with all required variable names when variables are missing', () => {
    expect(() => validateEnv({})).toThrow(
      'Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID',
    );
  });

  it('treats whitespace and non-string values as missing', () => {
    const config = {
      ...createValidConfig(),
      SUPABASE_URL: '   ',
      STRIPE_PRICE_ID: 42,
    };

    expect(() => validateEnv(config)).toThrow(
      'Missing required environment variables: SUPABASE_URL, STRIPE_PRICE_ID',
    );
  });
});
