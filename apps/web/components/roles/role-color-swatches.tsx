"use client";

import { Check, Ban } from "lucide-react";
import { ROLE_COLOR_PALETTE, type RoleColorHex } from "@repo/validation";

import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The role color control (#3485): "None" plus the ten palette swatches.
 *
 * It replaced a free `<input type="color">`. A role's color paints text (a
 * chat author's name), so a free pick could land on something unreadable on
 * charcoal; the palette in `@repo/validation` is contrast-checked against
 * every surface, and the API accepts nothing else.
 *
 * Toggle buttons in a labelled group rather than a radio group: each swatch is
 * one click to pick, and a screen reader hears the color name and whether it
 * is the current one.
 */
export function RoleColorSwatches({
  labelId,
  value,
  onChange,
  disabled,
}: {
  /** The id of the visible label that names this group. */
  labelId: string;
  value: RoleColorHex | null;
  onChange: (next: RoleColorHex | null) => void;
  disabled?: boolean;
}) {
  return (
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
        onClick={() => onChange(null)}
        className={cn(
          "grid size-7 place-items-center rounded-full border border-input text-muted-foreground transition-colors hover:bg-accent-subtle disabled:opacity-50",
          FOCUS_RING_OFFSET,
          value === null && "border-accent-text text-foreground",
        )}
      >
        <Ban aria-hidden="true" className="size-3.5" />
      </button>
      {ROLE_COLOR_PALETTE.map((swatch) => {
        const selected = value === swatch.hex;
        return (
          <button
            key={swatch.key}
            type="button"
            aria-pressed={selected}
            aria-label={swatch.label}
            title={swatch.label}
            disabled={disabled}
            onClick={() => onChange(swatch.hex)}
            className={cn(
              "grid size-7 place-items-center rounded-full border border-transparent transition-transform hover:scale-110 disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:scale-100",
              FOCUS_RING_OFFSET,
              selected &&
                "ring-2 ring-foreground ring-offset-2 ring-offset-card",
            )}
            // Palette literals: chapter data rendered as a raw swatch, so a
            // token reference would paint nothing.
            style={{ backgroundColor: swatch.hex }}
          >
            {selected ? (
              <Check aria-hidden="true" className="size-4 text-background" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
