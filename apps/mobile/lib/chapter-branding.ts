import { useMemo } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { orgHidingGreekLettersIn } from "@repo/org-archetypes";
import { chapterTextMark } from "@repo/validation";
import { useFrappTheme } from "./theme";

export type ChapterBranding = {
  /**
   * The accent to paint chapter-scoped UI with. Never null, so call sites need
   * no fallback of their own.
   *
   * This is `--signet-accent-text` — step 11 of the generated scale — read
   * from the chapter's served palette, or Signet's house gold when the palette
   * lacks it (no chapter resolved yet, or a row inserted without a palette
   * since the API's hourly sweep last ran).
   */
  accent: string;
  /**
   * The solid-fill accent — `--signet-accent-primary` (step 9), for a surface
   * that paints its own background rather than sitting on a neutral one (a
   * poll's chosen option; the chat self bubble was the first consumer until
   * the compact layout removed it, #2873). Falls back to Signet's house
   * gold for a palette without the pair, same as {@link accent}.
   */
  accentPrimary: string;
  /**
   * Text/icon color on {@link accentPrimary} — `--signet-accent-on-primary`,
   * contrast-corrected for exactly that pairing (accent-engine.md §8). Falls
   * back to `gold.onHouse` alongside {@link accentPrimary}.
   */
  accentOnPrimary: string;
  /**
   * A quiet accent-tinted fill and its border — `--signet-accent-subtle-bg`
   * (step 3) and `--signet-accent-border` (step 7) — for a selected chip or a
   * highlighted row that sits on a neutral surface and carries
   * {@link accent} text. Fall back together to the house `gold.askFill` /
   * `gold.askBorder` pair, and also whenever {@link accent} itself falls back.
   */
  accentSubtle: string;
  accentBorder: string;
  /** Signed URL from `GET /v1/chapters/current`, or null when no logo is set. */
  logoUrl: string | null;
  /** Falls back to text branding when there is no logo (spec/behavior/branding.md). */
  chapterName: string | null;
  /**
   * The chapter mark's text for when there is no logo: its short name, else
   * its Greek letters unless it turned them off, else null (#2876). From
   * `chapterTextMark`, the precedence every surface shares, so the opt-out
   * holds here without this hook reading the letters itself. An organization
   * that never displays its letters (FIJI) counts as turned off whatever its
   * stored switch says (#3421).
   */
  textMark: string | null;
};

function readString(
  source: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Per-chapter branding for the mobile member surface.
 *
 * Chapter identity is keyed off the active chapter the API client already
 * resolves, so a chapter change re-renders every consumer without a restart —
 * no separate invalidation, and nothing to reset on sign-out.
 *
 * ## The accent comes from the generated scale, not the raw seed
 *
 * `accent-engine.md` §1 and `spec/ui/mobile/README.md` both say it outright:
 * no component references the seed hex; only generated roles paint (§8 gates
 * the text roles, the solid fill and its hover shade, not the rest).
 * This used to paint `chapters.accent_color` — the seed itself — through a
 * runtime contrast check, because the API never checks a stored accent's
 * contrast on the dark card surface (it validates the format only;
 * `spec/behavior/branding.md`), so a legal stored accent could be unreadable
 * there.
 *
 * ## Step 11, not step 9
 *
 * The role this value plays is `accent-text` — "accent-colored text and icons
 * on neutral or subtle-bg surfaces" (`accent-engine.md` §2). Almost every
 * consumer treats it as a foreground: the active tab tint
 * (`app/(app)/(tabs)/_layout.tsx`), the state-block glyph, chip labels.
 *
 * `accent-primary` (step 9) is the *solid fill* role, and §8 holds it only to
 * the 3:1 non-text floor, not the 4.5:1 text floor. Painting it as a
 * foreground would miss AA: on `--card`, in a palette written since #2586
 * lightened both fills further, a crimson chapter's step 9 measures **4.23:1**
 * and a forest-green one **4.37:1** (3.32:1 and 3.34:1 after #2541 alone; a
 * palette stored before then paints its older, darker fill until the
 * stale-palette sweep recomputes it; `accent-engine.md` §4). Step 11 measures
 * 7.5–8.6:1 on `--card` for each of the five colours the chapter directory
 * seed holds today, and reads equally well as a chip fill under the fixed
 * `gold.onHouse` label (7.2:1+).
 *
 * So the generated scale removes the problem rather than compensating for it —
 * but only via the role that was specified for this job. A surface that wants a
 * solid accent fill should read `--signet-accent-primary` directly and pair it
 * with `--signet-accent-on-primary`, which is contrast-corrected for exactly
 * that pairing.
 *
 * ## A palette without the Signet map paints house gold
 *
 * The API's hourly stale-palette sweep recomputes every row an older engine
 * wrote (#1165), and production has run it, so the only palette that lacks
 * the map is a row inserted without one since the sweep's last successful
 * tick: a demo seed (`scripts/demo/demo-seed.sql`).
 * Such a row shows the house tokens until the next successful tick, normally
 * within the hour; web applies nothing to it either (`use-chapter-theme.ts`'s
 * all-or-nothing gate). The legacy branch
 * that re-validated the raw `accent_color` for those rows
 * (`resolveChapterAccentColor`) was deleted in #2595.
 *
 * `accentPrimary`/`accentOnPrimary` are gated **together**, both-or-neither —
 * not chained off `generatedAccent`'s own presence check, and not defaulted
 * independently. `SignetPalette` guarantees every engine token together in
 * principle, but nothing here re-validates that at the type level (`palette`
 * is a loosely-typed `jsonb` blob), so treating a palette with one of the pair
 * present and the other missing as "engine path, half-resolved" would pair a
 * chapter's real fill with the *house* foreground (or vice versa) — exactly
 * the uncontrasted combination this hook exists to prevent. Mirrors the
 * all-or-nothing `hasSignetSemanticRoles` gate (`@repo/chapter-theme/accent-vars`)
 * that `apps/web/lib/hooks/use-chapter-theme.ts` applies to this same
 * `theme_palette` data for the same reason.
 */
export function useChapterBranding(): ChapterBranding {
  const { data } = useCurrentChapter();
  const { tokens } = useFrappTheme();

  const brandAccent = tokens.color.gold.house;
  const brandOnAccent = tokens.color.gold.onHouse;
  const brandSubtle = tokens.color.gold.askFill;
  const brandBorder = tokens.color.gold.askBorder;
  // `|| null` rather than `??`: an empty string means unset, as it does for
  // the palette's roles below.
  const logoUrl = data?.logo_url || null;
  const chapterName = data?.name || null;
  // An organization that never displays its letters (FIJI) keeps them out of
  // the mark even when its stored switch was never turned off, as for a
  // chapter created before its org profile knew to (#3421). The match reads
  // the organization's name inside the chapter's ("Phi Gamma Delta Tau Nu").
  // Web's nav crest applies the same override (`chapter-nav-header.tsx`), and
  // the invite preview does it for the join card (`InviteService.preview`).
  const storedBranding = data?.branding as Record<string, unknown> | undefined;
  const textMark =
    chapterTextMark(
      orgHidingGreekLettersIn(data?.name)
        ? { ...storedBranding, show_greek_letters: false }
        : storedBranding,
    )?.text ?? null;
  const palette = data?.theme_palette;
  const generatedAccent = readString(palette, "--signet-accent-text");
  const generatedAccentPrimary = readString(palette, "--signet-accent-primary");
  const generatedAccentOnPrimary = readString(
    palette,
    "--signet-accent-on-primary",
  );
  const generatedSubtle = readString(palette, "--signet-accent-subtle-bg");
  const generatedBorder = readString(palette, "--signet-accent-border");
  // The pair is drawn under `accent` text, so it is the chapter's only when
  // that text is too: house gold text never lands on a chapter tint. The one
  // mix left, chapter text on the Ask fill, needs a palette holding step 11
  // without steps 3 and 7, which the engine never writes (it emits every
  // role together).
  const subtlePair = generatedAccent && generatedSubtle && generatedBorder;
  // Both present or neither used — see the doc comment above.
  const accentPrimary =
    generatedAccentPrimary && generatedAccentOnPrimary
      ? generatedAccentPrimary
      : brandAccent;
  const accentOnPrimary =
    generatedAccentPrimary && generatedAccentOnPrimary
      ? generatedAccentOnPrimary
      : brandOnAccent;

  return useMemo(
    () => ({
      accent: generatedAccent ?? brandAccent,
      accentPrimary,
      accentOnPrimary,
      accentSubtle: subtlePair ? generatedSubtle : brandSubtle,
      accentBorder: subtlePair ? generatedBorder : brandBorder,
      logoUrl,
      chapterName,
      textMark,
    }),
    [
      accentOnPrimary,
      accentPrimary,
      brandAccent,
      brandBorder,
      brandSubtle,
      generatedBorder,
      generatedSubtle,
      subtlePair,
      chapterName,
      generatedAccent,
      logoUrl,
      textMark,
    ],
  );
}
