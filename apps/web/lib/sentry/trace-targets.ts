/**
 * First-party API origins that may receive Sentry `sentry-trace` / `baggage`
 * headers. `x-request-id` is a different identifier space (minted by
 * `@repo/api-sdk`) and is not copied from these trace ids.
 *
 * Do not add PostHog, Sentry ingest, Supabase, or the marketing origin.
 */

export const FIRST_PARTY_API_ORIGINS = [
  "http://localhost:3001",
  "https://api-staging.frapp.live",
  "https://api.frapp.live",
] as const;

/**
 * Exact origins Sentry browser tracing may propagate to.
 *
 * Direct `process.env.NEXT_PUBLIC_API_URL` member access so Next inlines it.
 */
export function webTracePropagationTargets(
  apiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL,
): string[] {
  const origins = new Set<string>(FIRST_PARTY_API_ORIGINS);
  if (apiUrl) {
    try {
      origins.add(new URL(apiUrl).origin);
    } catch {
      // Unparseable API URL is ignored; the static first-party list remains.
    }
  }
  return [...origins];
}
