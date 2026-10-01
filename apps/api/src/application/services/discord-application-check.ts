import {
  DiscordApiError,
  type DiscordApplicationInfo,
} from '#domain/adapters/discord.interface';

/**
 * What Discord's own record says about this environment's Discord setup.
 *
 * Exists because the three settings that decide whether "Add to Server" works
 * live in three places no deploy can see together: Infisical (`API_URL`,
 * `DISCORD_CLIENT_ID`, `DISCORD_BOT_TOKEN`), code (`DISCORD_CALLBACK_PATH`) and
 * the Developer Portal (the Redirects list). The portal half used to be checked
 * by a human reading a table in `integrations.md` §7A, and it drifted twice: an
 * unregistered production row (#2318), then a staging `API_URL` carrying `/v1`
 * that built `/v1/v1/discord/connect/callback`. Both surfaced only as Discord's
 * own "Invalid OAuth2 redirect_uri" page, which reaches no log, no Sentry issue
 * and no callback.
 *
 * - `verified`: the token's application is the one the authorize URL names,
 *   and it lists this environment's redirect URI.
 * - `unverified`: Discord did not give an answer that settles it. The flow
 *   stays offered, because withdrawing it over a network blip would be the
 *   guard failing, not the setup.
 * - `misconfigured`: Discord's answer proves the flow cannot work. The flow is
 *   withdrawn and the reason reported, so an admin gets a sentence in the
 *   wizard instead of Discord's error page and an operator gets an alert.
 */
export type DiscordApplicationCheck =
  | { status: 'verified' }
  | { status: 'unverified'; kind: UnverifiedKind; reason: string }
  | { status: 'misconfigured'; kind: MisconfiguredKind; reason: string };

type UnverifiedKind = 'redirects_not_reported' | 'discord_unreachable';

type MisconfiguredKind =
  'redirect_unregistered' | 'client_id_mismatch' | 'bot_token_rejected';

const SETUP_DOC = 'docs/ops/deployment/integrations.md §7A';

/**
 * Compare Discord's record of the application with this environment's config.
 *
 * Exact string comparison, because that is the comparison Discord makes: a
 * registered row that differs by a trailing slash or a case-folded host still
 * lands the admin on the error page.
 */
export function evaluateDiscordApplication(args: {
  application: DiscordApplicationInfo;
  expectedClientId: string | null;
  redirectUri: string;
}): DiscordApplicationCheck {
  const { application, expectedClientId, redirectUri } = args;

  // First, because it decides which application's Redirects list is even the
  // right one to read. The authorize URL names DISCORD_CLIENT_ID; the list
  // below is the bot token's application's.
  if (expectedClientId !== null && application.id !== expectedClientId) {
    return {
      status: 'misconfigured',
      kind: 'client_id_mismatch',
      reason:
        `DISCORD_BOT_TOKEN belongs to Discord application ${application.id}, but DISCORD_CLIENT_ID is ${expectedClientId}. ` +
        'The consent screen would install one application’s bot while the importer reads as another’s, which is in no guild it was added to. ' +
        `Set both from the same application (${SETUP_DOC}, steps 2 and 3).`,
    };
  }

  if (application.redirectUris === null) {
    return {
      status: 'unverified',
      kind: 'redirects_not_reported',
      reason:
        `Discord’s record of application ${application.id} carried no redirect_uris, so whether ${redirectUri} is registered could not be checked. ` +
        `Confirm it by clicking "Add to Server" once and reaching the consent screen (${SETUP_DOC}, step 4).`,
    };
  }

  if (!application.redirectUris.includes(redirectUri)) {
    const registered = application.redirectUris.length
      ? application.redirectUris.join(', ')
      : 'none';
    return {
      status: 'misconfigured',
      kind: 'redirect_unregistered',
      reason:
        `Discord application ${application.id} has no OAuth2 redirect registered for ${redirectUri}, so every "Add to Server" click lands on Discord’s "Invalid OAuth2 redirect_uri" page. ` +
        `Registered: ${registered}. Add that exact string under Developer Portal → OAuth2 → Redirects (${SETUP_DOC}, step 4).`,
    };
  }

  return { status: 'verified' };
}

/**
 * Read a failed `GET /applications/@me` as a verdict.
 *
 * Only a 401 is conclusive: Discord refuses the token itself, which happens
 * when someone clicks Reset Token in the portal, and while staging and
 * production share one application (#2321) a reset for either kills both.
 * Anything else (a timeout, a 5xx, a rate limit) says nothing about the
 * setup, so it must not withdraw the flow.
 */
export function classifyApplicationFetchFailure(
  error: unknown,
): DiscordApplicationCheck {
  if (error instanceof DiscordApiError && error.status === 401) {
    return {
      status: 'misconfigured',
      kind: 'bot_token_rejected',
      reason:
        'Discord refused DISCORD_BOT_TOKEN (401): it was reset in the Developer Portal or belongs to no application. ' +
        `Every bot read fails until Infisical carries the current token and the API restarts (${SETUP_DOC}, step 2).`,
    };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return {
    status: 'unverified',
    kind: 'discord_unreachable',
    reason: `Could not read the Discord application to check its setup: ${detail}`,
  };
}

/**
 * Same verdict, for reporting on change rather than on every check.
 *
 * A misconfiguration compares its reason too, so a Redirects list edited from
 * one wrong state to another is reported again. An unverified one compares its
 * kind only, because its reason carries a transport error whose wording varies
 * from one timeout to the next.
 */
export function sameApplicationCheck(
  a: DiscordApplicationCheck | null,
  b: DiscordApplicationCheck,
): boolean {
  if (a === null) return false;
  if (a.status === 'verified' || b.status === 'verified') {
    return a.status === b.status;
  }
  if (a.status !== b.status || a.kind !== b.kind) return false;
  return a.status === 'unverified' || a.reason === b.reason;
}
