import type { ChapterBranding } from "@/lib/chapter-branding";

/**
 * Chapter branding fixtures for specs that mock `@/lib/chapter-branding`.
 *
 * The real hook reads the current chapter through the client provider these
 * specs don't mount, so each one hands it fixed values instead. They live here
 * so a spec restates none of them. `vi.mock` is hoisted above the spec's
 * imports, so a spec loads this module inside its factory:
 *
 * ```ts
 * vi.mock("@/lib/chapter-branding", async () => {
 *   const { chapterBrandingMock, PURPLE_BRANDING } =
 *     await import("@/test/chapter-branding");
 *   return chapterBrandingMock(PURPLE_BRANDING);
 * });
 * ```
 *
 * The two fixtures are deliberately different chapters and stay apart: several
 * specs assert on these exact hex values, and swapping one for the other
 * would change what those assertions prove.
 */

/**
 * A purple chapter, deliberately not house gold, so a control that slips back
 * to a `gold.*` token shows up in an assertion. The full hook shape.
 */
export const PURPLE_BRANDING = {
  accent: "#CB9FFF",
  accentPrimary: "#8E4EC6",
  accentOnPrimary: "#FFFFFF",
  accentSubtle: "#251A33",
  accentBorder: "#5C3E8A",
  logoUrl: null,
  chapterName: null,
  textMark: null,
} satisfies ChapterBranding;

/**
 * A muted-gold chapter (`#C49A3A`, not house gold) with purple subtle and
 * border fills, the shape the chat card specs were written against. It
 * predates `textMark` and leaves it out, as those specs always have.
 */
export const MUTED_GOLD_BRANDING = {
  accent: "#C49A3A",
  accentPrimary: "#C49A3A",
  accentOnPrimary: "#2B2009",
  accentSubtle: "#251A33",
  accentBorder: "#5C3E8A",
  logoUrl: null,
  chapterName: null,
} satisfies Omit<ChapterBranding, "textMark">;

/**
 * The module a `vi.mock("@/lib/chapter-branding", …)` factory returns: a hook
 * that hands back a fresh copy of `branding` on every call, as an inline
 * `() => ({ … })` mock did.
 */
export const chapterBrandingMock = (
  branding: Partial<ChapterBranding>,
): { useChapterBranding: () => Partial<ChapterBranding> } => ({
  useChapterBranding: () => ({ ...branding }),
});
