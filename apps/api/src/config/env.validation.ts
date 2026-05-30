const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID',
] as const;

// Optional (not validated at boot): the pseudonymous-analytics pipeline (#464)
// degrades to a no-op provider when these are unset, so local dev / tests / CI
// boot without them. In staging/production they are provisioned via Infisical
// (see docs/internal/environment/ENV_REFERENCE.md):
//   - ANALYTICS_HMAC_SALT  per-environment salt for hmac_sha256(salt, user_id)
//   - POSTHOG_API_KEY      enables the PostHog transport
//   - POSTHOG_HOST         optional provider host override (default PostHog US)

type EnvVar = (typeof REQUIRED_ENV_VARS)[number];

export function validateEnv(config: Record<string, unknown>) {
  const missingVars = REQUIRED_ENV_VARS.filter((envVar: EnvVar) => {
    const value = config[envVar];
    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`,
    );
  }

  return config;
}
