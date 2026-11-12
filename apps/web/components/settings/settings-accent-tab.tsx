"use client";

import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { type useUpdateChapter } from "@repo/hooks";
import { normalizeHex } from "@repo/color";
import { signetDarkTokens } from "@repo/theme/signet";
import { resolveChapterAccentColor } from "@/components/settings/resolve-chapter-accent";
import {
  formatFailingRatio,
  previewInkFor,
} from "@/components/settings/accent-preview-ink";
import { Button } from "@/components/ui/button";
import { ProfileSection } from "@/components/profile/profile-section";
import { Input } from "@/components/ui/input";
import { AccentSwatches } from "@/components/settings/accent-swatches";
import { EYEBROW } from "@/components/ui/typography";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

type FailedContrastCheck = { role: string; against: string; ratio: number };

/**
 * Names the surface a server-reported §8 contrast failure was measured
 * against, for the fixed four checks `deriveSignetPalette` can return
 * (`packages/chapter-theme/src/signet.ts`). Falls back to the raw values for
 * a shape a future engine change adds — never hides a real failure behind an
 * unrecognized pair.
 */
function describeFailedContrastCheck(check: FailedContrastCheck): string {
  const ratio = formatFailingRatio(check.ratio);
  if (
    check.role === "--signet-accent-text" &&
    check.against === "--signet-accent-subtle-bg"
  ) {
    return `Accent text on its own tinted background reads at ${ratio}:1, under the 4.5:1 minimum.`;
  }
  // Name a surface only when `against` is that surface's literal hex — never
  // inferred from `role` alone, so a future engine check on
  // `--signet-accent-text` against some other surface falls to the raw
  // fallback below instead of being mislabeled. Since the 2026-11-12 ladder
  // (#3826) the engine measures this check on `--popover`, the lightest step.
  if (check.role === "--signet-accent-text") {
    const surface = check.against.toUpperCase();
    if (surface === signetDarkTokens.color.surface.popover.toUpperCase()) {
      return `Accent text on menus and dialogs reads at ${ratio}:1, under the 4.5:1 minimum.`;
    }
    if (surface === signetDarkTokens.color.surface.background.toUpperCase()) {
      return `Accent text on the app background reads at ${ratio}:1, under the 4.5:1 minimum.`;
    }
  }
  if (
    check.role === "--signet-accent-on-primary" &&
    check.against === "--signet-accent-primary"
  ) {
    return `Text on the accent's solid fill reads at ${ratio}:1, under the 4.5:1 minimum.`;
  }
  if (
    check.role === "--signet-accent-on-primary" &&
    check.against === "--signet-accent-hover"
  ) {
    return `Text on the accent's hover shade reads at ${ratio}:1, under the 4.5:1 minimum.`;
  }
  return `${check.role} against ${check.against} reads at ${ratio}:1, under the 4.5:1 minimum.`;
}

export type AccentDraft = ReturnType<typeof useAccentDraft>;

/**
 * The Accent tab's unsaved draft, held by the page rather than the tab.
 * `TabsContent` carries no `forceMount`, so Radix unmounts the inactive tab;
 * state inside it would drop a half-typed colour whenever the officer glanced
 * at another tab.
 */
export function useAccentDraft(
  chapter: { accent_color?: string | null } | undefined,
) {
  const [value, setValue] = useState("");
  // The server's own §8 disclosure from the last successful save — distinct
  // from the tab's client-side checks of the unsaved draft. Cleared on the next edit so a stale warning never survives
  // past the accent it was measured against (#1183).
  const [contrastWarning, setContrastWarning] = useState<
    FailedContrastCheck[] | null
  >(null);

  useEffect(() => {
    if (!chapter) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the accent draft from the chapter query
    setValue(chapter.accent_color ?? "");
    // A resync (chapter switch, another tab's save, a background refetch) can
    // change the draft out from under a still-displayed warning, which would
    // otherwise describe a colour this render no longer shows (#1183).
    setContrastWarning(null);
  }, [chapter]);

  function update(next: string) {
    setValue(next);
    // A new edit invalidates the previous save's server-reported warning —
    // it described a different colour.
    setContrastWarning(null);
  }

  return { value, update, contrastWarning, setContrastWarning };
}

export function SettingsAccentTab({
  draft,
  canEditProfile,
  updateChapter,
  orgName,
}: {
  draft: AccentDraft;
  canEditProfile: boolean;
  /**
   * The chapter's name, which is its organization's on the directory path:
   * its official colors lead the swatches.
   */
  orgName?: string | null;
  /**
   * The page's instance, shared with the profile save: one `isPending` covers
   * both writes to `PATCH /v1/chapters/current`, as it did before the split.
   */
  updateChapter: ReturnType<typeof useUpdateChapter>;
}) {
  const { toast } = useToast();
  const accentDraft = draft.value;
  // Ties the disabled Save to the hint that says why (design-system README:
  // a disabled control is paired with its reason).
  const accentHexHintId = useId();

  // #1157: the preview swatch sits on a Signet card, so the WCAG check runs
  // against that dark surface, with a fallback legible on it. The resolver
  // requires both and throws on a non-hex value, so these stay constants.
  const accent = resolveChapterAccentColor(accentDraft || undefined, {
    background: signetDarkTokens.color.surface.card,
    fallbackAccent: signetDarkTokens.color.gold.house,
  });
  // What Save sends: the draft as the `#RRGGBB` the API's DTO requires. The
  // resolver above already reads a 3-digit shorthand or a padded hex as that
  // colour, so saving the same normalization keeps the preview, the warnings
  // and the save describing one colour. Sending the raw draft let `#08E`
  // preview cleanly and then fail the save with a 400.
  const accentDraftHex = normalizeHex(accentDraft);
  // Empty, blank or not a hex colour: Save is disabled and the tab says what to
  // enter. An empty draft counts: it sends no `accent_color`, which the API
  // treats as "no change" and answers with success, so the toast would claim a
  // save that wrote nothing. The copy is an instruction rather than a complaint
  // about "this color" because an empty field (a chapter with no stored
  // accent, or a cleared input) holds no colour to complain about, and it
  // takes warning styling only once something unsavable has been typed.
  const accentDraftUnsavable = !accentDraftHex;
  // A well-formed colour that fails contrast on the card. `fallbackApplied`
  // alone is also true for an empty or malformed draft, where "saving stores the
  // color you entered" would be false.
  const accentPreviewFallsBack = accent.reason === "insufficient_contrast";

  /*
    The label tone the "Preview" swatch draws on the draft colour: the better
    of the two (`previewInkFor`), never `--primary-foreground`, for the reason
    the swatch below gives.

    A warning used to sit under the swatch for a kept colour whose best label
    still missed 4.5:1 (`#0086FE` on the 2026-11-05 ladder). Since the
    2026-11-12 ladder's lighter `--card` (#3826) no colour the resolver keeps
    reaches that band, so it was deleted in #4388 rather than kept as a branch
    no member can see. `settings-contrast.spec.ts` sweeps the band and fails if
    a ladder change reopens it; bring a warning back then.
  */
  const preview = previewInkFor(accent.resolvedAccent);
  const previewInk = preview?.ink ?? signetDarkTokens.color.gold.onHouse;

  async function saveAccent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accentDraftHex) return;
    try {
      const result = await updateChapter.mutateAsync({
        accent_color: accentDraftHex,
      });
      draft.setContrastWarning(result?.failedContrastChecks ?? null);
      toast({
        title: "Accent color saved",
      });
    } catch (error) {
      toast({
        title: "Couldn't save accent color",
        description: getErrorMessage(error, "Retry, or check your connection."),
        variant: "destructive",
      });
    }
  }

  const accentContrastWarning = draft.contrastWarning;

  /*
  The accent section's hint.

  Every clause of the copy this replaces was false, and the last
  one had become false by being delivered.

  - **"branded PDF reports"** — the accent has never reached a
    PDF. `report-pdf.renderer.ts` draws from five fixed
    constants (`INK`, `MUTED`, `RULE`, `HEAD_FILL`,
    `ZEBRA_FILL`) and the branding payload
    `report-export.service.ts` hands it is
    `{ chapterName, university, logo }` — no colour of any kind.
  - **"against white"** — #1157 moved the check to the dark card
    it actually renders on (`resolveChapterAccentColor` is
    called with `background: surface.card` above). The code
    moved; the sentence did not.
  - **"invalid colors fall back to the [design system's]
    default"** —
    conflates two different outcomes. A hex the engine cannot
    parse falls back to `HOUSE_SEED`; a parseable colour that
    fails §8 contrast is **saved anyway** and disclosed by the
    server contrast warning below, because `chapter.service.ts` removed
    that gate deliberately ("gating it would reject 49 of the 50
    real chapters in the directory seed").
  - **"arrives in Chunk 07"** — this is chunk 07
    ([#2147](https://github.com/pdcarlson/Frapp/issues/2147)).

  An earlier draft of the replacement also claimed the accent
  paints "selected text". It does not, and the review is what
  caught it: `::selection` is deliberately the neutral ladder's
  two ends, because an accent-derived highlight is invisible on
  accent-painted fills (the chat self bubble when this was
  written, gone since #2873; primary buttons still). See the
  rule's own comment in
  `packages/theme/src/signet.css`.

  "Lightened where it needs to stand out" covers two engine
  steps, in order. The generator swaps in its own lighter step
  9 for a seed near the dark background (accent-engine.md §2),
  and then the §8 floor (#2541, #2586) lifts any scale whose
  fill, hover or label still falls short, swapped or not. So
  `#800000` paints its swapped `#F42F22` as is, `#003087`'s
  swapped `#1C6CFE` is lifted on to `#2D7BFF`, `#8B0000` is
  lifted to `#D75748`, and some vivid mid-tones move too
  (`#3366FF` paints `#4479FF`). Without the clause this card
  would promise a colour the save does not paint. The wording
  is mobile's Preferences row's.

  The closing sentence is board `2e`'s own preview caption
  (the mark and ✦ Ask never change), moved into the
  product. It is the one place an admin is choosing a colour, so
  it is the one place worth saying what the colour cannot reach.
  `settings-accent.spec.tsx` pins it against the tokens.
  */
  return (
    <ProfileSection
      id="settings-accent"
      title="Accent color"
      hint="Paints primary buttons, your own name in chat and the active nav item. The Frapp mark and the Ask pill keep their own colors."
    >
      <form onSubmit={saveAccent}>
        <div className="space-y-4">
          <AccentSwatches
            value={accentDraftHex}
            orgName={orgName}
            onPick={draft.update}
            disabled={!canEditProfile}
          />
          <p className={`${EYEBROW} text-muted-foreground`}>Custom color</p>
          <div className="flex flex-wrap items-center gap-4">
            <Input
              type="color"
              aria-label="Accent color picker"
              value={accentDraftHex || accent.resolvedAccent}
              onChange={(event) => draft.update(event.target.value)}
              className="h-10 w-24 p-1 pointer-coarse:h-11"
            />
            <Input
              aria-label="Accent color hex value"
              value={accentDraft}
              onChange={(event) => draft.update(event.target.value)}
              placeholder={signetDarkTokens.color.gold.seed}
              className="max-w-xs font-mono"
            />
            {/*
              The one place a raw chapter hex legitimately paints — it
              is a preview *of* that hex, which is the carve-out
              README §2's ban is written around. The text on top is the
              part that has been wrong twice.

              It shipped as `text-white`: a guess, and wrong for every
              light seed the directory holds (`#FFFFFF`, `#C0C0C0`,
              `#C9A56F`), where white on the fill is 1.0–2.2:1 and the
              word disappears. The obvious fix — `text-primary-foreground`
              — is wrong in a subtler way, and the pre-push review
              caught it: that token is `--signet-accent-on-primary`,
              written once from the chapter's **saved** palette. This
              swatch previews the **draft**, recomputed on every
              keystroke, so an admin on a dark saved accent typing a
              light draft would watch the fill go pale while the text
              stayed white. `resolveChapterAccentColor` cannot help:
              it returns the accent's legibility *as text on a
              background*, and no on-accent tone at all.

              So it is computed here, from the draft, against §4's own
              two ends of the text ladder, taking the better one. No
              kept colour's best tone misses AA on today's ladder
              (#4388, `settings-contrast.spec.ts`).
            */}
            <div
              className="flex h-10 w-36 items-center justify-center rounded-md text-sm font-semibold pointer-coarse:h-11"
              style={{
                backgroundColor: accent.resolvedAccent,
                color: previewInk,
              }}
            >
              Preview
            </div>
          </div>
          {accentDraftUnsavable ? (
            <p
              id={accentHexHintId}
              className={
                accentDraft === ""
                  ? "text-xs text-muted-foreground"
                  : "text-xs text-warning"
              }
            >
              Enter a hex code like #5AA9E6 to save an accent color.
            </p>
          ) : null}
          {accentPreviewFallsBack ? (
            <p className="text-xs text-warning">
              This color is hard to read on the card, so the preview shows{" "}
              {accent.resolvedAccent} instead. Saving stores the color you
              entered, and the palette is derived from it.
            </p>
          ) : null}
          {/*
            Independent of the draft checks above, which run client-side
            on the unsaved draft (the contrast one against a single
            fixed backdrop). This is the server's own §8
            verdict on the colour actually saved, generated through
            the real design-system pipeline. §8 forbids a runtime
            substitution here, so a failing save still succeeds — this
            discloses rather than corrects (#1183).
          */}
          {accentContrastWarning && accentContrastWarning.length > 0 ? (
            <p className="text-xs text-warning">
              {accentContrastWarning.map(describeFailedContrastCheck).join(" ")}{" "}
              Try a lighter or darker shade of this hue and save again.
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            type="submit"
            disabled={
              !canEditProfile || updateChapter.isPending || accentDraftUnsavable
            }
            aria-describedby={
              accentDraftUnsavable ? accentHexHintId : undefined
            }
          >
            {updateChapter.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Save accent color
          </Button>
        </div>
      </form>
    </ProfileSection>
  );
}
