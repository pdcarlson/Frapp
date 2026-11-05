import { File, FileCheck, KeyRound, Lock, type LucideIcon } from "lucide-react";
import { roleColor, type RoleColorKey } from "@repo/validation";
import { highlightRuns } from "@/lib/search/fuzzy-match";
import { cn } from "@/lib/utils";

/*
 * What tells one backwork row from the next at a glance (Paul, 2026-11-05:
 * "rows should be differentiable"): a colored tag for the kind of assignment,
 * and an icon for which copy it is.
 *
 * The tag colors come from the role palette, the one set of hues already
 * checked for AA text contrast on every surface a row sits on, hovered row
 * included (`role-colors.ts`). That palette leaves out red and gold on
 * purpose, so exams read rose, not error red.
 */
const TYPE_COLOR: Record<string, RoleColorKey> = {
  Exam: "rose",
  Midterm: "rose",
  "Final Exam": "rose",
  Quiz: "orange",
  Homework: "periwinkle",
  Lab: "teal",
  Project: "violet",
  "Study Guide": "green",
  Notes: "lime",
  Other: "slate",
};

export function TypeTag({ type }: { type: string | null }) {
  if (!type) return null;
  const hex = roleColor(TYPE_COLOR[type] ?? "slate");
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 truncate rounded-xs px-2 py-0.5 text-caption font-semibold"
      style={{
        color: hex,
        backgroundColor: `color-mix(in srgb, ${hex} 14%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-[2px]"
        style={{ backgroundColor: hex }}
      />
      <span className="truncate">{type}</span>
    </span>
  );
}

/*
 * One icon per copy type, all from the same set and drawn in the row's muted
 * text tone (Paul: "with the copy, keep the icons consistent"). A redacted
 * file adds a lock beside it.
 */
const VARIANT: Record<string, { icon: LucideIcon; label: string }> = {
  "Student Copy": { icon: FileCheck, label: "Student copy" },
  "Blank Copy": { icon: File, label: "Blank copy" },
  "Answer Key": { icon: KeyRound, label: "Answer key" },
};

export function CopyLabel({
  variant,
  redacted,
}: {
  variant: string | null;
  redacted: boolean;
}) {
  const known = variant ? VARIANT[variant] : undefined;
  if (!known && !redacted) return null;
  const Icon = known?.icon;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground">
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      {known?.label ?? variant}
      {redacted ? (
        <Lock
          className="h-3.5 w-3.5 shrink-0"
          role="img"
          aria-label="Redacted"
        >
          <title>Redacted</title>
        </Lock>
      ) : null}
    </span>
  );
}

/** Text with the words a search matched set in the accent tint. */
export function Highlighted({
  text,
  hits,
  className,
}: {
  text: string;
  hits: readonly string[];
  className?: string;
}) {
  const runs = highlightRuns(text, hits);
  return (
    <span className={className}>
      {runs.map((run, index) =>
        run.hit ? (
          <mark
            key={index}
            className={cn("rounded-[3px] bg-accent-subtle px-px text-accent-text")}
          >
            {run.text}
          </mark>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </span>
  );
}
