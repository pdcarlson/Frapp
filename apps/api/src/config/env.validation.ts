const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID',
] as const;

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
