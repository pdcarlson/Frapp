import type { ReactNode } from "react";
import { SectionLabel } from "@/components/shared/section-label";

/**
 * One block of `/profile`: a section on the page surface, named by its
 * section label, with at most one line under the label saying what the block
 * controls when the label alone can't. The Page grammar's "no wrapper card"
 * rule (`spec/ui/web-dashboard/README.md`), applied to a screen that used to
 * stack seven `Card`s, each with its own description.
 *
 * `id` is the anchor other screens link to (the account menu's
 * "Notification settings" row lands on `#notification-settings`), so
 * `scroll-mt-16` keeps the label clear of the sticky top bar on arrival.
 */
export function ProfileSection({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const labelId = `${id}-label`;
  return (
    <section
      id={id}
      aria-labelledby={labelId}
      className="scroll-mt-16 space-y-4"
    >
      <div className="space-y-1">
        <SectionLabel id={labelId}>{title}</SectionLabel>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}
