/**
 * The chapter wizard's identity step, shared by web and mobile.
 *
 * Both first-officer wizards (`apps/web/components/onboarding/chapter-wizard.tsx`
 * and `apps/mobile/app/(auth)/create-chapter.tsx`) collect the same fields and
 * send them on the same `POST /v1/chapters/onboard` payload. Each used to carry
 * its own copy of these helpers, and the copies drifted: mobile uppercased the
 * accent and web did not, and mobile defaulted to the retired Frapp bronze while
 * web used the Signet seed (#1642, #2102). One definition means one input
 * produces one stored value on either surface.
 *
 * Deliberately pure: no React, no react-query. It is a subpath export, like
 * `./display-names`, so importing it does not pull a query client into a
 * plain-function graph.
 */

import { normalizeHex } from "@repo/color";
import { signetDarkTokens } from "@repo/theme/signet";

/**
 * The accent a chapter starts with when the directory has none and the founder
 * doesn't pick one: the Signet house seed itself, not a copy of its hex, so a
 * seed change moves both wizards together.
 *
 * Read from `@repo/theme/signet`, not `@repo/chapter-theme`'s `HOUSE_SEED`: that
 * package's `index.ts` re-exports through a `./signet.js` specifier Turbopack
 * cannot resolve from source, so the import passes vitest and fails `next build`
 * (`spec/ui/web-greenfield/tokens.md` § One duplicate removed).
 */
export const DEFAULT_CHAPTER_ACCENT = signetDarkTokens.color.gold.seed;

export type ChapterIdentityForm = {
  name: string;
  university: string;
  greekLetters: string;
  designation: string;
  schoolShort: string;
  foundedYear: string;
  colorAccent: string;
};

export const EMPTY_CHAPTER_IDENTITY: Readonly<ChapterIdentityForm> =
  Object.freeze({
    name: "",
    university: "",
    greekLetters: "",
    designation: "",
    schoolShort: "",
    foundedYear: "",
    colorAccent: DEFAULT_CHAPTER_ACCENT,
  });

/**
 * Parses what a founder typed or pasted into the accent field, or `fallback`
 * when it isn't a colour.
 *
 * The contract is `@repo/color`'s `normalizeHex`, the one Settings saves
 * through, so the wizard and Settings store the same string for the same
 * colour. That means uppercase `#RRGGBB`, with a 3-digit shorthand expanded
 * (the API's DTO accepts only six digits).
 *
 * One affordance sits on top: a bare hex with no `#` (`DDB844`, as colour
 * pickers often copy it) is accepted. Neither wizard can tell the founder what
 * it rejected: web substitutes the default without a word, and mobile, which
 * passes the raw input as `fallback`, fails the whole create with the API's
 * validation error. Neither is a fair answer to a value that unambiguously
 * names a colour. Settings can stay strict because it shows an explicit
 * unsavable state instead.
 */
export function normalizeAccentInput(
  value: string | null | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return fallback;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return normalizeHex(withHash) || fallback;
}

/** Guard-parse a founded-year input. Returns a finite year >= 1776 or undefined. */
export function parseFoundedYear(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1776 || parsed > 9999)
    return undefined;
  return parsed;
}

/**
 * Whether the identity step can submit. These are the API's own `MinLength`
 * bounds on `ChapterOnboardingDto` (name 3, university 2), checked after a trim
 * because the wizards send trimmed values.
 */
export function chapterIdentityIsValid(identity: ChapterIdentityForm): boolean {
  return (
    identity.name.trim().length >= 3 && identity.university.trim().length >= 2
  );
}
