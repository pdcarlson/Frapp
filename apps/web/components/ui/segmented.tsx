"use client";

import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";

/**
 * Segmented control, `spec/ui/design-system/components.md` § Segmented
 * control: two or three answers side by side, the held one lit, so the current
 * answer never hides behind a menu. A 1px `border-control-edge` track on `surface-1`,
 * padding 2, each segment 32px to a mouse and 44 on touch, the held one in the
 * accent's subtle tint with accent text, the rest muted. A radio group to
 * assistive tech.
 *
 * `fill` stretches the track to its container with equal segments (a form
 * row); without it the track hugs its labels (a toolbar or a table row).
 */
export function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  fill = false,
  className,
}: {
  label: string;
  /**
   * `disabled` on one option greys out that answer alone (a Roles override a
   * caller may not grant), and `title` gives it a hover hint saying why.
   * `quiet` draws the answer, when held, in neutral rather than the accent:
   * the default a row starts on, so the rows set apart from it are the ones
   * that stand out down a long list.
   */
  options: readonly {
    value: T;
    label: string;
    disabled?: boolean;
    title?: string;
    quiet?: boolean;
  }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex rounded-md border border-control-edge bg-surface-1 p-0.5",
        fill ? "w-full" : "shrink-0",
        className,
      )}
    >
      {options.map((option) => {
        const held = option.value === value;
        const off = disabled || Boolean(option.disabled);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={held}
            disabled={off}
            title={option.title}
            onClick={() => {
              if (!held) onChange(option.value);
            }}
            className={cn(
              "flex min-h-8 items-center justify-center whitespace-nowrap rounded-sm px-3 text-sm font-semibold transition-colors pointer-coarse:min-h-11",
              fill && "flex-1",
              // The held answer as chat search's filter radios draw theirs.
              held
                ? option.quiet
                  ? "bg-card-hover text-foreground"
                  : "bg-accent-subtle text-accent-text"
                : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
              off && "pointer-events-none text-disabled",
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
