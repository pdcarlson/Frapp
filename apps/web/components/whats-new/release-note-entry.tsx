import {
  formatReleaseNoteDate,
  releaseNoteGroups,
  type ReleaseNote,
} from "@repo/validation";
import { SectionLabel } from "@/components/shared/section-label";

/**
 * One What's new entry: its date label, title and lines, in the page
 * (`whats-new.tsx`) and the dialog that opens by itself after an update
 * (`whats-new-host.tsx`). The lines true on both come first; the web-only
 * and phone-only ones follow under a Web and a Mobile subheading
 * (`releaseNoteGroups`), as on the phone. An entry from before the split is
 * one list. `idPrefix` keeps the label ids apart when the page and the
 * dialog are both mounted.
 */
export function ReleaseNoteEntry({
  note,
  idPrefix,
}: {
  note: ReleaseNote;
  idPrefix: string;
}) {
  const labelId = `${idPrefix}-${note.date}`;
  return (
    <section aria-labelledby={labelId} className="space-y-3">
      <SectionLabel id={labelId}>{formatReleaseNoteDate(note.date)}</SectionLabel>
      <h3 className="text-sm font-semibold text-foreground">{note.title}</h3>
      {releaseNoteGroups(note).map((group) => (
        <div key={group.place} className="space-y-1.5">
          {group.label ? (
            <h4 className="pt-1 text-xs font-semibold text-foreground">
              {group.label}
            </h4>
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
