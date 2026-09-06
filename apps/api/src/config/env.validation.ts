const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
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
//
// Also optional, same reasoning (#994): the rotating event check-in code.
// Unset, `GET /v1/events/:eventId/attendance/check-in-token` returns 503 and a
// supplied token is rejected; plain self check-in and the geofence are
// unaffected, so no test or local flow depends on it being present.
//   - EVENT_CHECK_IN_TOKEN_SECRET  per-environment HMAC key for check-in codes
//
// Also optional, same reasoning (#1243): the Discord bot import path. Unset,
// `GET /v1/discord/availability` answers `available: false`, the wizard offers
// only the DiscordChatExporter upload flow, and every other Discord route
// answers 503. The upload flow is a SEPARATE path, not a fallback that switches
// on — it works identically whether or not any of these are set.
//
// All four are needed together; three of the four are not enough to run the
// flow, which is why `DiscordOAuthService.isAvailable()` checks all of them
// rather than degrading:
//   - DISCORD_BOT_TOKEN      ONE global Signet bot token (not per-tenant — the
//                            per-chapter value is a guild id, in the database).
//   - DISCORD_CLIENT_ID      the Discord application's client id, for the
//                            authorize URL.
//   - DISCORD_CLIENT_SECRET  for the server-to-server code exchange, which is
//                            what proves the authorizing human runs the server.
//   - API_URL / APP_URL      the redirect URI must be registered in the Discord
//                            Developer Portal EXACTLY as
//                            `${API_URL}/v1/discord/connect/callback`, and the
//                            callback sends the browser back to `APP_URL`.
//
// Also optional, same reasoning (#238): email-based bulk invites. Unset,
// `selectEmailProvider()` uses a no-op provider that logs instead of sending,
// so local dev / tests / CI never need a real email credential — the invite
// tokens still get created either way, only delivery is skipped.
//   - RESEND_API_KEY    enables the Resend transport for invite emails
//   - RESEND_FROM_EMAIL optional from-address override (default a Frapp address
//                       that must be verified with Resend before it will send)
//
// NOT here, and deliberately absent rather than merely unlisted:
// SUPABASE_ANON_KEY. The API holds exactly one Supabase client and it is
// built from SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// (infrastructure/supabase/supabase.provider.ts). The anon key is the
// browser's and the mobile app's credential — it identifies a client that
// authenticates *as a user* and is then constrained by RLS, which is the
// opposite of what a service-role process does. The rule this encodes:
// require an environment variable where its value is read, not where a
// name happens to be associated with the product. Requiring it here blocked
// boot on a credential no code path in this process ever loads.
// It is still provisioned — for the clients that do read it. Which names
// resolve to it, and where, is documented once in
// docs/internal/environment/ENV_REFERENCE.md; do not restate that mapping here.

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
