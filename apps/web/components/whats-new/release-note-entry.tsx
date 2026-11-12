"use client";

import { useState } from "react";
import {
  formatReleaseNoteDate,
  openingReleaseNotePlace,
  releaseNoteGroups,
  type ReleaseNote,
  type ReleaseNotePlace,
} from "@repo/validation";
import { SectionLabel } from "@/components/shared/section-label";
import { SegmentedChoice } from "@/components/ui/segmented";

/**
 * One What's new entry: its date label, title and lines, in the page
 * (`whats-new.tsx`) and the dialog that opens by itself after an update
 * (`whats-new-host.tsx`).
 *
 * An entry whose lines are split by place (`releaseNoteGroups`) puts a
 * switch over them, Both, Web and Phone with each one's count, so the
 * breakdown reads before any line does and one place's lines show at a time.
 * It opens on Web, the surface the reader is on, as the phone's opens on
 * Phone (`openingReleaseNotePlace`). An older entry is one list with no
 * switch. `idPrefix` keeps the label ids apart when the page and the dialog
 * are both mounted.
 */
export function ReleaseNoteEntry({
  note,
  idPrefix,
}: {
  note: ReleaseNote;
  idPrefix: string;
}) {
  const labelId = `${idPrefix}-${note.date}`;
  const groups = releaseNoteGroups(note);
  const [place, setPlace] = useState<ReleaseNotePlace | null>(() =>
    openingReleaseNotePlace(groups, "web"),
  );
  const split = Boolean(groups[0]?.label);
  const shown = split
    ? groups.filter((group) => group.place === place)
    : groups;
  return (
    <section aria-labelledby={labelId} className="space-y-3">
      <SectionLabel id={labelId}>
        {formatReleaseNoteDate(note.date)}
      </SectionLabel>
      <h3 className="text-sm font-semibold text-foreground">{note.title}</h3>
      {split && groups.length > 1 && place ? (
        <SegmentedChoice
          label={`Where these changes are, ${formatReleaseNoteDate(note.date)}`}
          dense
          value={place}
          onChange={setPlace}
          options={groups.map((group) => ({
            value: group.place,
            label: `${group.short} ${group.lines.length}`,
          }))}
        />
      ) : null}
      {shown.map((group) => (
        <div key={group.place} className="space-y-1.5">
          {/* A split entry with one place names it, since no switch does. */}
          {split && groups.length === 1 ? (
            <p className="text-xs font-medium text-foreground">{group.label}</p>
          ) : null}
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground marker:text-muted">
            {group.lines.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
