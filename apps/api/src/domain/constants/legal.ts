/**
 * The Terms of Service and Privacy Policy version the API enforces. Bump it
 * whenever either page changes materially; spec/behavior/legal.md § Acceptance
 * record says to what, and `scripts/ci/__tests__/legal-policy-version.test.mjs`
 * enforces it against the pages.
 *
 * Only the API reads it, so it lives here rather than in `@repo/validation`
 * (#3268). It stamps it onto a chapter at onboarding and onto a user when they
 * accept, and a user whose stored version differs is asked again, so a bump
 * re-prompts everyone once. Clients never compare against it:
 * they ask `GET /v1/users/me/legal-acceptance`, because a store binary compiled
 * with an older value would otherwise disagree with the server.
 */
export const LEGAL_POLICY_VERSION = '2026-09.2';
