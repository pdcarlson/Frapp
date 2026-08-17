/**
 * The canonical legal pages, reachable from inside the app (#275).
 *
 * `spec/behavior/legal.md` requires Terms, Privacy and the FERPA notice to be
 * reachable from the landing footer, web settings, mobile settings and chapter
 * creation. The landing site and the web onboarding wizard link them; the
 * signed-in mobile surface did not — which is the surface where the member is
 * actually uploading Backwork files, location data and chat messages.
 *
 * The base URL mirrors web's `LEGAL_BASE_URL`
 * (`apps/web/components/onboarding/chapter-wizard.tsx`): overridable per
 * environment, defaulting to production so the links always resolve even when
 * nothing is configured. `EXPO_PUBLIC_` is the prefix Expo inlines into the
 * bundle, matching `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SUPABASE_*`.
 */
const LEGAL_BASE_URL =
  process.env.EXPO_PUBLIC_LANDING_URL ?? "https://frapp.live";

export interface LegalLink {
  label: string;
  url: string;
}

export const LEGAL_LINKS: readonly LegalLink[] = [
  { label: "Terms of Service", url: `${LEGAL_BASE_URL}/terms` },
  { label: "Privacy Policy", url: `${LEGAL_BASE_URL}/privacy` },
  { label: "FERPA Notice", url: `${LEGAL_BASE_URL}/ferpa` },
];
