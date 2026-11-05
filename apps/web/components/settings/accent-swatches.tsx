"use client";

import { Check } from "lucide-react";
import { ACCENT_PRESETS, type AccentSwatch } from "@repo/hooks/chapter-identity";
import { orgColorsFor } from "@repo/org-archetypes";
import { EYEBROW } from "@/components/ui/typography";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * Web's accent swatches: the organization's own colors first, then the common
 * presets, so picking an accent is a click rather than a hex. Mobile's
 * `AccentPicker` draws the same two groups from the same two lists
 * (`spec/behavior/branding.md` § Accent Color, "nobody wants to type a hex").
 * The browser's color input and the hex field stay beside it on each surface
 * for a color that is neither.
 *
 * A swatch paints the seed as stored, not the shade the engine derives from
 * it: it shows the color being chosen. The organization is looked up by name
 * only, never by Greek letters, because some organizations don't display
 * theirs.
 */

function sameHex(a: string | null | undefined, b: string): boolean {
  return (a ?? "").toUpperCase() === b.toUpperCase();
}

export function AccentSwatches({
  value,
  orgName,
  onPick,
  disabled = false,
}: {
  /** The current draft, `#RRGGBB` (or anything, when the draft isn't a color yet). */
  value: string | null | undefined;
  /** The organization's name, for its official colors. */
  orgName: string | null | undefined;
  onPick: (hex: string) => void;
  disabled?: boolean;
}) {
  const orgColors: readonly AccentSwatch[] = orgColorsFor(orgName);
  const presets = ACCENT_PRESETS.filter(
    (preset) => !orgColors.some((swatch) => sameHex(swatch.hex, preset.hex)),
  );

  function swatchButton(swatch: AccentSwatch, labelled: boolean) {
    const selected = sameHex(value, swatch.hex);
    return (
      <button
        key={`${swatch.name}-${swatch.hex}`}
        type="button"
        aria-pressed={selected}
        aria-label={swatch.name}
        title={labelled ? undefined : swatch.name}
        disabled={disabled}
        onClick={() => onPick(swatch.hex)}
        className={cn(
          "group flex min-h-9 items-center gap-2 rounded-full pointer-coarse:min-h-11 disabled:cursor-not-allowed disabled:opacity-60",
          labelled ? "pr-3" : "",
          FOCUS_RING,
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            selected ? "border-foreground" : "border-transparent group-hover:border-input",
          )}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{ backgroundColor: swatch.hex }}
          >
            {selected ? (
              <Check className="h-3.5 w-3.5 text-white mix-blend-difference" aria-hidden />
            ) : null}
          </span>
        </span>
        {labelled ? (
          <span className="text-sm font-semibold text-foreground">{swatch.name}</span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {orgColors.length > 0 ? (
        <div role="group" aria-label="Your organization's colors" className="space-y-1.5">
          <p className={`${EYEBROW} text-muted-foreground`}>Your organization</p>
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            {orgColors.map((swatch) => swatchButton(swatch, true))}
          </div>
        </div>
      ) : null}
      <div role="group" aria-label="More colors" className="space-y-1.5">
        <p className={`${EYEBROW} text-muted-foreground`}>
          {orgColors.length > 0 ? "More colors" : "Colors"}
        </p>
        <div className="flex flex-wrap gap-1">
          {presets.map((swatch) => swatchButton(swatch, false))}
        </div>
      </div>
    </div>
  );
}
