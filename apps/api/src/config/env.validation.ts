import {
  assertProductionAppOrigin,
  isProductionSupabaseUrl,
} from '@repo/validation';
import { validateClientPolicyEnv } from '../application/services/client-policy.service';
import { classifySupabaseKey } from './supabase-key';

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
//   - POSTHOG_API_KEY      enables the PostHog Node lifecycle adapter
//   - POSTHOG_HOST         optional provider host override (default PostHog US)
//   - POSTHOG_LOGS_SAMPLE_RATE  sanitized PostHog logs sample in [0, 1]
//                          (default 1.0 via parseSampleRate; not a stdout pipe)
//
// Also optional, same reasoning (#994): the rotating event check-in code.
// Unset, `GET /v1/events/:eventId/attendance/check-in-token` returns 503 and a
// supplied token is rejected; plain self check-in and the geofence are
// unaffected, so no test or local flow depends on it being present.
//   - EVENT_CHECK_IN_TOKEN_SECRET  per-environment HMAC key for check-in codes
//
// Also optional, same reasoning (#1243): the Discord bot import path. Unset,
// `GET /v1/discord/availability` answers `available: false` and the wizard
// greys the "Connect Discord" card out, leaving the DiscordChatExporter upload
// flow as the only selectable source. Only the two routes that begin or confirm
// a handshake 503 — `POST /v1/discord/connect` and `/connect/confirm`, the two
// that call `assertAvailable()`; `GET`/`DELETE /v1/discord/connection` answer
// 200 and the callback answers a redirect by contract. The upload flow is a
// SEPARATE path, not a fallback that switches on — it works identically whether
// or not any of these are set.
//
// All five are needed together; four of the five are not enough to run the
// flow, which is why `DiscordOAuthService.isConfigured()` checks all of them
// rather than degrading (`isAvailable()` then also asks Discord whether the
// application behind them is set up right):
//   - DISCORD_BOT_TOKEN      ONE global Frapp bot token (not per-tenant — the
//                            per-chapter value is a guild id, in the database).
//   - DISCORD_CLIENT_ID      the Discord application's client id, for the
//                            authorize URL.
//   - DISCORD_CLIENT_SECRET  for the server-to-server code exchange, which is
//                            what proves the authorizing human runs the server.
//   - API_URL / APP_URL      the redirect URI must be registered in the Discord
//                            Developer Portal EXACTLY as
//                            `${API_URL}/v1/discord/connect/callback` (a stray
//                            trailing `/v1` on API_URL is dropped first), and
//                            the callback sends the browser back to `APP_URL`.
//                            Whether it is registered is checked against
//                            Discord at runtime (at boot, on a TTL, and before
//                            each connect), and only where Discord's answer
//                            lists the redirects; not here. See
//                            `discord-application-check.ts`.
//
// Also optional, same reasoning (#238): email-based bulk invites. Unset,
// `selectEmailProvider()` uses a no-op provider that logs instead of sending,
// so local dev / tests / CI never need a real email credential — the invite
// tokens still get created either way, only delivery is skipped.
//   - RESEND_API_KEY    enables the Resend transport for invite emails
//   - RESEND_FROM_EMAIL optional from-address override (default a Frapp address
//                       that must be verified with Resend before it will send)
//
// Also optional (#2526): the mobile minimum-version policy. Unset, no build is
// ever told to update. Unlike the rest of this list, a value that IS set is
// checked here, because a malformed minimum would read as "no minimum" and
// switch the gate off silently. Rules: validateClientPolicyEnv.
//   - MOBILE_MIN_VERSION_IOS / MOBILE_MIN_VERSION_ANDROID
//   - MOBILE_UPDATE_URL_IOS / MOBILE_UPDATE_URL_ANDROID
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

  const serviceKeyProblem = serviceKeyAuthorityProblem(
    config.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  if (serviceKeyProblem) throw new Error(serviceKeyProblem);

  const clientPolicyProblems = validateClientPolicyEnv(config);
  if (clientPolicyProblems.length > 0) {
    throw new Error(clientPolicyProblems.join(' '));
  }

  // Production invite emails are built from APP_URL. https: alone still
  // allows https://app.staging.frapp.live, which would send the first cohort
  // to staging. Unset APP_URL keeps the production-origin fallback in
  // invite-link.util.ts. The Docker image does not copy .github/, so the
  // production Supabase host is identified by @repo/validation (pinned to
  // environments.json in that package's tests).
  const supabaseUrl = config.SUPABASE_URL;
  const appUrl = config.APP_URL;
  if (
    typeof supabaseUrl === 'string' &&
    isProductionSupabaseUrl(supabaseUrl) &&
    typeof appUrl === 'string' &&
    appUrl.trim().length > 0
  ) {
    assertProductionAppOrigin(appUrl, 'APP_URL');
  }

  return config;
}

/**
 * Refuses a `SUPABASE_SERVICE_ROLE_KEY` that is recognisably a CLIENT key.
 *
 * The API's one Supabase client runs as service_role, and its tenant
 * isolation is application-layer because RLS has no permissive policies. Built
 * on a client key instead, it still boots, and every table read then returns
 * an empty result rather than an error, so the chapter just looks empty.
 * The likeliest way to get there is the #2532 key swap, where the publishable
 * and secret keys sit one row apart on Supabase's API Keys page.
 *
 * Either service key passes: the legacy `service_role` JWT or a `sb_secret_…`
 * key. So does anything this cannot classify, which is what test and CI
 * stand-ins are; the check refuses only what it can positively identify. The
 * value is never echoed, because a boot log reaches further than the secret
 * store.
 */
function serviceKeyAuthorityProblem(raw: string): string | null {
  if (raw.includes('${')) {
    return (
      'SUPABASE_SERVICE_ROLE_KEY is an unresolved variable reference, not a ' +
      'key. Infisical expands `${…}` at sync time; a store that keeps it ' +
      'verbatim leaves the API unable to reach Supabase.'
    );
  }
  switch (classifySupabaseKey(raw)) {
    case 'publishable':
    case 'client_jwt':
      return (
        'SUPABASE_SERVICE_ROLE_KEY holds a client key (the publishable key or ' +
        'the legacy anon JWT), not a service key. The API would boot and then ' +
        'read nothing, because RLS hides every row from a client key. Use the ' +
        'secret key (`sb_secret_…`) or the legacy `service_role` JWT.'
      );
    default:
      return null;
  }
}
