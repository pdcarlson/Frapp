import type { ReactNode } from "react";
import { EYEBROW } from "@/components/ui/typography";

/**
 * A flushed route's section label: the `EYEBROW` `<h2>` its
 * `<section aria-labelledby>` takes its name from, and the count beside it.
 *
 * Six lists drew this by hand (the Directory, alumni, documents, Chat Admin's
 * channels and categories, and the Discord imports), and moving web type onto
 * the Signet roles (#3090) meant rewriting the count's size in each copy. One
 * recipe, so a change to the label's tone or size reaches every list at once.
 *
 * `count` renders only when given. Pass `null` while there is nothing to
 * count yet rather than a placeholder: "0 documents" while the read is in
 * flight is a claim about the list, not a description of it.
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
    <div className="flex min-w-0 items-baseline gap-2">
      <h2 id={id} className={`${EYEBROW} truncate text-muted-foreground`}>
        {children}
      </h2>
      {count == null || count === false ? null : (
        <p className="shrink-0 text-caption text-muted">{count}</p>
      )}
    </div>
  );
}
