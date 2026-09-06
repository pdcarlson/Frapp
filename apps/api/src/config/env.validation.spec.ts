import { validateEnv } from './env.validation';

// `validateEnv` is the first thing that runs on boot (ConfigModule.forRoot in
// app.module.ts), so a wrong entry in REQUIRED_ENV_VARS crash-loops the
// container on Render and surfaces as `update_failed` — a post-build state, so
// the build logs look clean and only the runtime log carries the cause. It
// names the variable outright (`Missing required environment variables: X`),
// which is the one thing worth knowing when triaging that deploy state; do not
// confuse it with the MODULE_NOT_FOUND signature, which is the unrelated
// dependency-shape failure the api-docker-build boot probe exists to catch.
describe('validateEnv', () => {
  const complete = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_ID: 'price_x',
  };

  it('accepts a config carrying every required variable', () => {
    expect(validateEnv({ ...complete })).toEqual(complete);
  });

  it('returns the config unchanged, extra keys included', () => {
    const withExtras = { ...complete, PORT: '3001', UNRELATED: 'x' };
    expect(validateEnv(withExtras)).toBe(withExtras);
  });

  // The regression this file exists for. SUPABASE_ANON_KEY was required at
  // boot while nothing in `apps/api/src` read it — the Supabase client there is
  // built from SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  // (infrastructure/supabase/supabase.provider.ts) — so the API refused to start
  // without a credential it never loads.
  //
  // Asserted against the error from an EMPTY config, which enumerates every name
  // the array demands, rather than against `complete`. The difference matters: a
  // `complete`-based assertion fails with "Missing required environment
  // variables: SUPABASE_ANON_KEY", which points at the fixture, and the shortest
  // green path is to add the key to `complete` — silencing the test while
  // reinstating the regression. This one names the variable itself, so there is
  // no fixture edit that defuses it.
  it('does not demand SUPABASE_ANON_KEY — the API holds no anon-key client', () => {
    let message = '';
    try {
      validateEnv({});
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('Missing required environment variables:');
    expect(message).not.toContain('SUPABASE_ANON_KEY');
  });

  it.each([
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_ID',
  ])('throws naming %s when it is absent', (name) => {
    const { [name]: _omitted, ...missing } = complete;
    expect(() => validateEnv(missing)).toThrow(
      `Missing required environment variables: ${name}`,
    );
  });

  // An empty or whitespace value is rejected exactly as an absent key is —
  // a name present in Infisical with a blank value still fails at boot.
  // DB_PROMOTION_RUNBOOK.md's pre-promotion checklist depends on this.
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('rejects %s as it rejects an absent key', (_why, value) => {
    expect(() => validateEnv({ ...complete, SUPABASE_URL: value })).toThrow(
      'Missing required environment variables: SUPABASE_URL',
    );
  });

  it('rejects a non-string value', () => {
    expect(() => validateEnv({ ...complete, STRIPE_PRICE_ID: 42 })).toThrow(
      'Missing required environment variables: STRIPE_PRICE_ID',
    );
  });

  it('names every missing variable in one error, not just the first', () => {
    expect(() =>
      validateEnv({ SUPABASE_URL: 'https://example.supabase.co' }),
    ).toThrow(
      'Missing required environment variables: SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID',
    );
  });
});
