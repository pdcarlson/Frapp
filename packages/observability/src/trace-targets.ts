/**
 * First-party API origins that may receive Sentry `sentry-trace` / `baggage`.
 * `x-request-id` is a different identifier space (minted by `@repo/api-sdk`)
 * and is not copied from these trace ids.
 *
 * Do not add PostHog, Sentry ingest, Supabase, or the marketing origin.
 * App-specific `API_URL` env reads stay in web/mobile so Next/Expo can inline
 * them; this helper only unions an already-resolved URL with the static list.
 */

export const FIRST_PARTY_API_ORIGINS = [
  "http://localhost:3001",
  "https://api-staging.frapp.live",
  "https://api.frapp.live",
] as const;

/**
 * Scheme + host (+ port) of an already-resolved API URL. Avoids `URL` so
 * this CJS package can compile with `lib: ["es2022"]` and no DOM.
 */
function originOf(apiUrl: string): string | undefined {
  const match = /^(https?):\/\/([^/?#]+)/i.exec(apiUrl.trim());
  if (!match) return undefined;
  return `${match[1]!.toLowerCase()}://${match[2]!.toLowerCase()}`;
}

export function firstPartyTracePropagationTargets(
  apiUrl: string | undefined,
): string[] {
  const origins = new Set<string>(FIRST_PARTY_API_ORIGINS);
  if (apiUrl) {
    const origin = originOf(apiUrl);
    if (origin) origins.add(origin);
  }
  return [...origins];
}
