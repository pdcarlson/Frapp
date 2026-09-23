/**
 * The legal pages live on the marketing site (spec/behavior/legal.md). Override
 * per environment with NEXT_PUBLIC_LANDING_URL; the default is production, so
 * the links resolve even when nothing is configured. Mirrors mobile's
 * `EXPO_PUBLIC_LANDING_URL` in `apps/mobile/lib/more/legal.ts`.
 */
export const LEGAL_BASE_URL =
  process.env.NEXT_PUBLIC_LANDING_URL ?? "https://frapp.live";

export const TERMS_URL = `${LEGAL_BASE_URL}/terms`;
export const PRIVACY_URL = `${LEGAL_BASE_URL}/privacy`;
export const FERPA_URL = `${LEGAL_BASE_URL}/ferpa`;
