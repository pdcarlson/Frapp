"use client";

import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";

/**
 * Segmented control, `spec/ui/design-system/components.md` § Segmented
 * control: two or three answers side by side, the held one lit, so the current
 * answer never hides behind a menu. A 1px `border-input` track on `surface-1`,
 * padding 2, each segment 32px to a mouse and 44 on touch, the held one in the
 * accent's subtle tint with accent text, the rest muted. A radio group to
 * assistive tech.
 *
 * `fill` stretches the track to its container with equal segments (a form
 * row); without it the track hugs its labels (a toolbar or a table row).
 *
 * `quiet` holds the answer in neutral ink, for a row whose answer only follows
 * a default set elsewhere (Who's coming's roles that follow "Everyone else"),
 * so the rows set apart are the ones lit.
 */
export function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  fill = false,
  quiet = false,
  dense = false,
  className,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  fill?: boolean;
  quiet?: boolean;
  /** Caption-size labels and tighter padding, for a control beside a name in a list row. */
  dense?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex rounded-md border border-input bg-surface-1 p-0.5",
        fill ? "w-full" : "shrink-0",
        className,
      )}
    >
      {options.map((option) => {
        const held = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={held}
            disabled={disabled}
            onClick={() => {
              if (!held) onChange(option.value);
            }}
            className={cn(
              "flex min-h-8 items-center justify-center whitespace-nowrap rounded-sm font-semibold transition-colors pointer-coarse:min-h-11",
              dense ? "px-2 text-caption" : "px-3 text-sm",
              fill && "flex-1",
              // The held answer as chat search's filter radios draw theirs.
              held
                ? quiet
                  ? "bg-card text-foreground"
                  : "bg-accent-subtle text-accent-text"
                : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
              disabled && "pointer-events-none text-disabled",
              FOCUS_RING,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
