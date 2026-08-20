/**
 * Identity + branding helpers for the mobile chapter wizard.
 *
 * Hex colors are **payload data** for `POST /v1/chapters/onboard` (same defaults
 * the web wizard sends). They are not Signet chrome — UI chrome still reads
 * tokens. Matching web: `apps/web/components/onboarding/chapter-wizard.tsx`.
 */

export const DEFAULT_DARK = "#1F1A15";
export const DEFAULT_ACCENT = "#7A5A2F";
const HEX6 = /^#[0-9a-fA-F]{6}$/;

export type IdentityForm = {
  name: string;
  university: string;
  greekLetters: string;
  designation: string;
  schoolShort: string;
  foundedYear: string;
  colorDark: string;
  colorAccent: string;
};

export const EMPTY_IDENTITY: IdentityForm = {
  name: "",
  university: "",
  greekLetters: "",
  designation: "",
  schoolShort: "",
  foundedYear: "",
  colorDark: DEFAULT_DARK,
  colorAccent: DEFAULT_ACCENT,
};

export function normalizeHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return HEX6.test(withHash) ? withHash.toUpperCase() : fallback;
}

/** Guard-parse a founded-year input. Returns a finite year >= 1776 or undefined. */
export function parseFoundedYear(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1776 || parsed > 9999) return undefined;
  return parsed;
}

export function identityIsValid(identity: IdentityForm): boolean {
  return identity.name.trim().length >= 3 && identity.university.trim().length >= 2;
}
