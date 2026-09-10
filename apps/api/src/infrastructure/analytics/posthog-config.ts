/**
 * Parse PostHog API credentials. Missing, blank, or malformed values are a
 * no-op: the Nest process must boot without a provider secret, and a typo
 * must not construct a client that would enqueue against a junk host.
 *
 * The project key is `phc_…`. A personal API key (`phx_…`) is never accepted
 * here — local flag evaluation and the management API are out of scope, and
 * #709's deleted-users automation is a dashboard workflow, not this client.
 */

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/** Project API keys only. Personal keys (`phx_`) are rejected as malformed. */
export const POSTHOG_PROJECT_KEY_RE = /^phc_[A-Za-z0-9_-]+$/;

export type PosthogConfigReason =
  'ok' | 'missing' | 'empty' | 'malformed_key' | 'malformed_host';

export interface PosthogConfig {
  apiKey: string;
  host: string;
}

export interface PosthogConfigParseResult {
  config: PosthogConfig | null;
  reason: PosthogConfigReason;
}

/**
 * Normalize a configured `POSTHOG_HOST` into the origin requests are sent to.
 * Exported so boot logs can name the resolved host without duplicating the
 * fallback rules. Blank / whitespace is the US Cloud default — that is not
 * a malformed value; an explicit non-http(s) URL is.
 */
export function resolvePosthogHost(host?: string): string {
  return (host?.trim() || DEFAULT_POSTHOG_HOST).replace(/\/$/, '');
}

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

export function parsePosthogConfig(env: {
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}): PosthogConfigParseResult {
  const rawKey = env.POSTHOG_API_KEY;
  if (rawKey === undefined) {
    return { config: null, reason: 'missing' };
  }

  const apiKey = rawKey.trim();
  if (apiKey.length === 0) {
    return { config: null, reason: 'empty' };
  }
  if (!POSTHOG_PROJECT_KEY_RE.test(apiKey)) {
    return { config: null, reason: 'malformed_key' };
  }

  const rawHost = env.POSTHOG_HOST;
  const host = resolvePosthogHost(rawHost);
  // An explicitly set host that is not an http(s) origin is a misconfiguration.
  // Unset / blank already fell through to the US Cloud default.
  if (
    rawHost !== undefined &&
    rawHost.trim().length > 0 &&
    !isHttpOrigin(host)
  ) {
    return { config: null, reason: 'malformed_host' };
  }
  if (!isHttpOrigin(host)) {
    return { config: null, reason: 'malformed_host' };
  }

  return { config: { apiKey, host }, reason: 'ok' };
}
