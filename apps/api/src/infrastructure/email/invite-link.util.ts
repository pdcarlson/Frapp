import type { ConfigService } from '@nestjs/config';

/**
 * Mirrors `apps/mobile/lib/onboarding/chapter-wizard/invite-link.ts`: the web
 * dashboard builds `${window.location.origin}/join?token=…` client-side, but
 * an emailed invite has no browser origin to read, so the API needs its own
 * resolution. Prefer `APP_URL` when configured; otherwise the production
 * dashboard origin, so an invite email sent from an environment with no
 * `APP_URL` set still links somewhere real rather than to `undefined` or a
 * made-up staging host.
 */
const PRODUCTION_APP_ORIGIN = 'https://app.frapp.live';

export function resolveAppOrigin(config: ConfigService): string {
  const configured = config.get<string>('APP_URL');
  const trimmed = configured?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : PRODUCTION_APP_ORIGIN;
}

export function buildJoinUrl(token: string, origin: string): string {
  return `${origin}/join?token=${encodeURIComponent(token)}`;
}
