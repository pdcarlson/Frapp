import { PRODUCTION_SUPABASE_PROJECT_REF } from '@repo/validation';
import { deploymentEnvironment } from './deployment-environment';

const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
const STAGING_SUPABASE_URL = 'https://hnoyzpidbmizhbqaiity.supabase.co';

describe('deploymentEnvironment', () => {
  it.each([
    ['production', 'production'],
    ['staging', 'staging'],
    [' production ', 'production'],
    ['development', 'local'],
    ['test', 'local'],
    ['', 'local'],
    [undefined, 'local'],
    // Case matters: Render sets these exact strings, and a near-miss is not
    // production.
    ['Production', 'local'],
  ])('reads NODE_ENV %p as %s', (nodeEnv, expected) => {
    expect(
      deploymentEnvironment({
        NODE_ENV: nodeEnv,
        SUPABASE_URL: 'http://127.0.0.1:54321',
      }),
    ).toBe(expected);
  });

  // A misset NODE_ENV on frapp-api-prod must not hand production a laptop's
  // hop count and switch its tripwire off (#2972).
  it.each([undefined, '', 'development', 'Production', 'staging'])(
    'is production for the production database whatever NODE_ENV (%p) says',
    (nodeEnv) => {
      expect(
        deploymentEnvironment({
          NODE_ENV: nodeEnv,
          SUPABASE_URL: PRODUCTION_SUPABASE_URL,
        }),
      ).toBe('production');
    },
  );

  it('keeps staging on the staging database', () => {
    expect(
      deploymentEnvironment({
        NODE_ENV: 'staging',
        SUPABASE_URL: STAGING_SUPABASE_URL,
      }),
    ).toBe('staging');
  });

  it('reads this process when given nothing', () => {
    // Jest runs with NODE_ENV=test and no production database.
    expect(deploymentEnvironment()).toBe('local');
  });
});
