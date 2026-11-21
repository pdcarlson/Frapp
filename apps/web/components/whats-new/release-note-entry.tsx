"use client";

import {
  FRESH_RELEASE_NOTE_CAPTION,
  formatReleaseNoteDate,
  freshReleaseNoteLines,
  releaseNoteGroups,
  type ReleaseNote,
} from "@repo/validation";
import { SectionLabel } from "@/components/shared/section-label";
import { cn } from "@/lib/utils";
import { useFreshReleaseLines } from "@/lib/whats-new-fresh";

/**
 * One What's new entry: its date label, title and lines, in the page
 * (`whats-new.tsx`) and the dialog that opens by itself after an update
 * (`whats-new-host.tsx`). The lines true on both come first; the web-only
 * and phone-only ones follow under a Web and a Mobile subheading
 * (`releaseNoteGroups`), as on the phone. An entry from before the split is
 * one list. `idPrefix` keeps the label ids apart when the page and the
 * dialog are both mounted.
 *
 * Lines that came with this browser's latest deploy are bold, in the
 * foreground color, under a one-line caption saying so, when the entry also
 * holds older lines (`freshReleaseNoteLines`; Paul, 2026-11-16). `fresh`
 * overrides what `lib/whats-new-fresh.ts` worked out, for tests.
 */
export function ReleaseNoteEntry({
  note,
  idPrefix,
  fresh,
}: {
  note: ReleaseNote;
  idPrefix: string;
  fresh?: readonly string[];
}) {
  const labelId = `${idPrefix}-${note.date}`;
  const browserFresh = useFreshReleaseLines();
  const marked = freshReleaseNoteLines(note, fresh ?? browserFresh);
  return (
    <section aria-labelledby={labelId} className="space-y-3">
      <SectionLabel id={labelId}>{formatReleaseNoteDate(note.date)}</SectionLabel>
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-foreground">{note.title}</h3>
        {marked.size > 0 ? (
          <p className="text-xs text-muted-foreground">
            {FRESH_RELEASE_NOTE_CAPTION}
          </p>
        ) : null}
      </div>
      {releaseNoteGroups(note).map((group) => (
        <div key={group.place} className="space-y-1.5">
          {group.label ? (
            <h4 className="pt-1 text-xs font-semibold text-foreground">
              {group.label}
            </h4>
          ) : null}
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground marker:text-muted">
            {group.lines.map((change) => (
              <li
                key={change}
                className={cn(
                  marked.has(change) && "font-semibold text-foreground",
                )}
              >
                {marked.has(change) ? (
                  <span className="sr-only">New: </span>
                ) : null}
                {change}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
