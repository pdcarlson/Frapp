import type { ReactNode } from "react";

/** One label-over-value row of a flat detail list. */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
      <dt className="shrink-0 text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm">{children}</dd>
    </div>
  );
}

/** The bordered list a member sheet's {@link DetailRow}s sit in. */
export const DETAIL_LIST = "divide-y divide-border rounded-md border border-border";
