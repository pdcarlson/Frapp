"use client";

import { useState } from "react";
import { Ban, Check } from "lucide-react";
import {
  isPaletteRoleColor,
  reservedBandForHue,
  reservedRoleHueReason,
  ROLE_COLOR_PALETTE,
  roleColorForHue,
  roleColorHue,
} from "@repo/validation";

import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The colors a hue track samples, one stop every 6 degrees: each stop is the
 * color that slider position paints, so a reserved band shows as the flat
 * edge color its picks are moved to rather than a red or gold nobody can save.
 */
const TRACK_GRADIENT = `linear-gradient(to right, ${Array.from(
  { length: 61 },
  (_, index) => roleColorForHue(index * 6).hex,
).join(", ")})`;

/** A plain word for a hue, for the slider's spoken value. OKLCH degrees. */
function hueName(hue: number): string {
  if (hue < 12 || hue >= 345) return "pink";
  if (hue < 65) return "orange";
  if (hue < 130) return "yellow green";
  if (hue < 170) return "green";
  if (hue < 205) return "teal";
  if (hue < 245) return "sky blue";
  if (hue < 285) return "blue";
  if (hue < 315) return "violet";
  return "magenta";
}

/**
 * The role and group color control (#3485, #5784): "None", the ten palette
 * swatches as quick picks, and a hue slider for any other color, the way
 * Discord's role color picker pairs swatches with a custom picker.
 *
 * A color paints text (a chat author's name, a chip's dot), so the slider
 * picks a hue, not a hex: `roleColorForHue` in `@repo/validation` sets its
 * lightness so it reads at AA on every surface, and moves it out of red
 * (alerts, mentions) and gold (Frapp's own color), with a line saying why. The
 * track paints what each position saves. The API accepts the same set
 * (`isPaintableRoleColor`).
 *
 * Toggle buttons in a labelled group rather than a radio group: each swatch is
 * one click to pick, and a screen reader hears the color name and whether it
 * is the current one.
 */
export function RoleColorPicker({
  labelId,
  value,
  onChange,
  disabled,
}: {
  /** The id of the visible label that names this control. */
  labelId: string;
  /** A paintable color (`roleColorOrNull`), or `null` for none. */
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const custom = value !== null && !isPaletteRoleColor(value);
  // Where the thumb sits: the slider's own last position while it is being
  // used, otherwise the current color's hue (a palette swatch has one too).
  const [dragHue, setDragHue] = useState<number | null>(null);
  const hue = Math.round(dragHue ?? (value ? (roleColorHue(value) ?? 0) : 0));
  const reserved = dragHue === null ? null : reservedBandForHue(dragHue);
  const hintId = `${labelId}-hue-hint`;

  return (
    <div className="grid gap-3">
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap items-center gap-1.5"
      >
        <button
          type="button"
          aria-pressed={value === null}
          aria-label="No color"
          title="No color"
          disabled={disabled}
          onClick={() => {
            setDragHue(null);
            onChange(null);
          }}
          className={cn(
            "grid size-7 place-items-center rounded-full border border-input text-muted-foreground transition-colors hover:bg-card-hover disabled:opacity-50",
            FOCUS_RING_OFFSET,
            value === null && "border-accent-text text-foreground",
          )}
        >
          <Ban aria-hidden="true" className="size-3.5" />
        </button>
        {ROLE_COLOR_PALETTE.map((swatch) => (
          <Swatch
            key={swatch.key}
            label={swatch.label}
            hex={swatch.hex}
            selected={value === swatch.hex}
            disabled={disabled}
            onPick={() => {
              setDragHue(null);
              onChange(swatch.hex);
            }}
          />
        ))}
        {custom ? (
          <Swatch
            label="Custom color"
            hex={value}
            selected
            disabled={disabled}
            onPick={() => onChange(value)}
          />
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <input
          type="range"
          min={0}
          max={359}
          step={1}
          value={hue}
          disabled={disabled}
          aria-label="Custom hue"
          aria-describedby={hintId}
          aria-valuetext={`${hueName(hue)}, ${hue} degrees`}
          onChange={(event) => {
            const next = Number(event.target.value);
            setDragHue(next);
            onChange(roleColorForHue(next).hex);
          }}
          className={cn(
            "h-3 w-full max-w-sm cursor-pointer appearance-none rounded-full disabled:cursor-default disabled:opacity-50",
            FOCUS_RING_OFFSET,
            "[&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-foreground [&::-webkit-slider-thumb]:bg-background",
            "[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-foreground [&::-moz-range-thumb]:bg-background",
          )}
          // Computed colors: chapter data rendered as a raw track, so a token
          // reference would paint nothing.
          style={{ backgroundImage: TRACK_GRADIENT }}
        />
        <p
          id={hintId}
          aria-live="polite"
          className="text-caption text-muted-foreground"
        >
          {reserved
            ? `${reservedRoleHueReason(reserved)} This is the nearest color you can use.`
            : "Slide for any other color. Each one is adjusted so names stay readable."}
        </p>
      </div>
    </div>
  );
}

function Swatch({
  label,
  hex,
  selected,
  disabled,
  onPick,
}: {
  label: string;
  hex: string;
  selected: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "grid size-7 place-items-center rounded-full border border-transparent transition-transform hover:scale-110 disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:scale-100",
        FOCUS_RING_OFFSET,
        selected && "ring-2 ring-foreground ring-offset-2 ring-offset-card",
      )}
      // Palette literals: chapter data rendered as a raw swatch, so a token
      // reference would paint nothing.
      style={{ backgroundColor: hex }}
    >
      {selected ? (
        <Check aria-hidden="true" className="size-4 text-background" />
      ) : null}
    </button>
  );
}
