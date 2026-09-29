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
  /** The chapter mark's short name, e.g. "FIJI" (#2876). */
  shortName: string;
  /**
   * Whether the chapter shows its Greek letters. The directory autofill fills
   * `greekLetters` for every chapter it knows, FIJI's included, so a chapter
   * whose organization doesn't display its letters turns this off rather than
   * having to clear a field the wizard filled for it.
   */
  showGreekLetters: boolean;
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
    shortName: "",
    showGreekLetters: true,
    designation: "",
    schoolShort: "",
    foundedYear: "",
    colorAccent: DEFAULT_CHAPTER_ACCENT,
  });

/**
 * Parses what a founder typed or pasted into the accent field into the value
 * the chapter stores. Anything that isn't a colour becomes
 * {@link DEFAULT_CHAPTER_ACCENT}.
 *
 * The contract is `@repo/color`'s `normalizeHex`, the one Settings saves
 * through, so the wizard and Settings store the same string for the same
 * colour: uppercase `#RRGGBB`, with a 3-digit shorthand expanded (the API's DTO
 * accepts only six digits).
 *
 * One affordance sits on top: a bare hex with no `#` (`DDB844`, as colour
 * pickers often copy it) is accepted. A value that unambiguously names a colour
 * shouldn't be swapped for the default. Settings can stay strict because it
 * shows an explicit unsavable state; the wizard has none, so a blank or
 * unparseable field takes the default instead. Web's native colour input can't
 * produce one, and mobile's swatch previews this function's result, so the
 * founder sees the colour that will be stored.
 */
export function normalizeAccentInput(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return DEFAULT_CHAPTER_ACCENT;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return normalizeHex(withHash) || DEFAULT_CHAPTER_ACCENT;
}

/** The earliest founded year any chapter form accepts. */
export const FOUNDED_YEAR_MIN = 1776;

/**
 * The latest founded year any chapter form accepts: next year, so a chapter
 * chartering over New Year isn't refused. The wizards and Settings share this
 * bound. When the wizards allowed up to 9999, a mistyped `2999` was stored and
 * then blocked every later Settings > Org save until someone fixed the year.
 */
export function latestFoundedYear(now: Date = new Date()): number {
  return now.getFullYear() + 1;
}

/**
 * Guard-parse a founded-year input. Returns a year between
 * {@link FOUNDED_YEAR_MIN} and {@link latestFoundedYear}, or undefined.
 */
export function parseFoundedYear(
  raw: string,
  now: Date = new Date(),
): number | undefined {
  if (!raw.trim()) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (
    !Number.isFinite(parsed) ||
    parsed < FOUNDED_YEAR_MIN ||
    parsed > latestFoundedYear(now)
  )
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

export type ChapterIdentityBranding = {
  greek_letters?: string;
  short_name?: string;
  show_greek_letters?: false;
  designation?: string;
  school_short?: string;
  founded_at?: number;
  colors: { accent: string };
};

/**
 * The `branding` block of `POST /v1/chapters/onboard`, built the same way on
 * both surfaces, so the same identity form always sends the same payload.
 */
export function chapterIdentityBranding(
  identity: ChapterIdentityForm,
): ChapterIdentityBranding {
  return {
    greek_letters: identity.greekLetters.trim() || undefined,
    short_name: identity.shortName.trim() || undefined,
    // Sent only as an opt-out; absent means shown, as it does in Settings.
    show_greek_letters: identity.showGreekLetters ? undefined : false,
    designation: identity.designation.trim() || undefined,
    school_short: identity.schoolShort.trim() || undefined,
    founded_at: parseFoundedYear(identity.foundedYear),
    colors: { accent: normalizeAccentInput(identity.colorAccent) },
  };
}
