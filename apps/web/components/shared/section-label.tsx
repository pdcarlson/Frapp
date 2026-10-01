import type { ReactNode } from "react";
import { EYEBROW } from "@/components/ui/typography";

/**
 * A flushed route's section label: the `EYEBROW` `<h2>` its
 * `<section aria-labelledby>` takes its name from, and the count beside it.
 *
 * Every flushed list drew this by hand, and the copies drifted (a count in a
 * different tone, a label that overflowed instead of truncating); moving web
 * type onto the Signet roles (#3090) then meant rewriting each copy's count.
 * One recipe, so a change to the label's tone or size reaches every list. A
 * route's own mark (Backwork's glyph) sits beside it, outside.
 *
 * `count` renders only when given. Pass `null` while there is nothing to
 * count yet rather than a placeholder: "0 documents" while the read is in
 * flight is a claim about the list, not a description of it. A long count
 * wraps under the label rather than squeezing it.
 */
export function SectionLabel({
  id,
  children,
  count,
}: {
  id: string;
  children: ReactNode;
  count?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <h2 id={id} className={`${EYEBROW} truncate text-muted-foreground`}>
        {children}
      </h2>
      {count == null || count === false ? null : (
        <p className="shrink-0 text-caption text-muted tabular-nums">{count}</p>
      )}
    </div>
  );
}
