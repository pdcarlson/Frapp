/**
 * The step indicator for a multi-step flow — one recipe, because there were
 * two spellings of it in this one directory.
 *
 * `chapter-wizard.tsx` drew four `flex-1` bars (`bg-primary` / `bg-border`) and
 * `onboarding-tutorial.tsx` drew eight fixed `h-1.5 w-4` pills with the same
 * two tones. Two live spellings of one indicator is what the cutover rule
 * forbids, and it was already producing drift: only one of them shipped a
 * textual counter.
 *
 * **The track is `--background`, not `--border`.**
 * `components/shared/meter.ts` measured the five candidates across all 19
 * seeded chapter colours and `bg-border` came third on the relationship that
 * carries the data (1.133:1 fill-vs-track, against `--background`'s 1.774) —
 * and the tutorial's indicator renders inside a `DialogContent`, where
 * `bg-popover` and `bg-accent-subtle` collapse to 1.000:1 and 1.001:1 outright.
 * `--background` is the bottom of the ladder, so it recedes below whatever
 * container it is placed in and cannot invert. That table is not re-derived
 * here; this module inherits it.
 *
 * **The bar is never the only signal**, which is `meter.ts`'s other rule and
 * the one the wizard broke: it wrapped the whole indicator in `aria-hidden`
 * and printed no step count anywhere, so a screen-reader user in a four-step
 * chapter-creation flow was never told which step they were on. The counter is
 * part of the recipe rather than a call-site option — it is the accessible
 * name for the thing the bars draw, and `role="group"` carries it so the label
 * is announced when focus enters the flow.
 *
 * The fill is the chapter accent. Both consumers mount inside `DashboardShell`,
 * so the accent bridge is live and §5's "accent-worthy stat" reading applies —
 * progress through a flow is a tally, not a status.
 */

import { cn } from "@/lib/utils";

export function StepDots({
  current,
  total,
  className,
}: {
  /** Zero-based index of the step in progress. */
  current: number;
  total: number;
  className?: string;
}) {
  const step = Math.min(Math.max(current, 0), Math.max(total - 1, 0));

  return (
    <div
      role="group"
      aria-label={`Step ${step + 1} of ${total}`}
      className={cn("flex items-center gap-3", className)}
    >
      <span className="shrink-0 text-[12.5px] font-semibold text-muted-foreground">
        Step {step + 1} of {total}
      </span>
      <span aria-hidden="true" className="flex flex-1 items-center gap-1.5">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index <= step ? "bg-primary" : "bg-background",
            )}
          />
        ))}
      </span>
    </div>
  );
}
