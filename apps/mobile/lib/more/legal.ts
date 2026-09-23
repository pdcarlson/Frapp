/**
 * The canonical legal pages, reachable from inside the app (#275).
 *
 * `spec/behavior/legal.md` § In-App Placement says where each is linked. On
 * mobile that is Settings (`(tabs)/preferences.tsx`, `LEGAL_LINKS`, all three)
 * and the Terms checkbox on join, create-chapter and the Terms prompt
 * (`ACCEPTANCE_LINKS`, the two it agrees to). The signed-in app is where members share chat messages, photos
 * and location, so the documents that govern those have to be one tap away.
 *
 * The base URL mirrors web's `LEGAL_BASE_URL` (`apps/web/lib/legal-links.ts`):
 * overridable per environment, defaulting to production so the links always
 * resolve even when nothing is configured. `EXPO_PUBLIC_` is the prefix Expo
 * inlines into the bundle, matching `EXPO_PUBLIC_API_URL` and
 * `EXPO_PUBLIC_SUPABASE_*`.
 */
const LEGAL_BASE_URL =
  process.env.EXPO_PUBLIC_LANDING_URL ?? "https://frapp.live";

export interface LegalLink {
  label: string;
  url: string;
}

const TERMS_LINK: LegalLink = {
  label: "Terms of Service",
  url: `${LEGAL_BASE_URL}/terms`,
};
const PRIVACY_LINK: LegalLink = {
  label: "Privacy Policy",
  url: `${LEGAL_BASE_URL}/privacy`,
};

export const LEGAL_LINKS: readonly LegalLink[] = [
  TERMS_LINK,
  PRIVACY_LINK,
  { label: "FERPA Notice", url: `${LEGAL_BASE_URL}/ferpa` },
];

/**
 * The two documents the Terms checkbox agrees to (#2302). The FERPA notice is
 * about Backwork, which the app doesn't have (#2258), and nobody accepts it.
 */
export const ACCEPTANCE_LINKS: readonly LegalLink[] = [
  TERMS_LINK,
  PRIVACY_LINK,
];
