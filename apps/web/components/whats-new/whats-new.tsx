import {
  RELEASE_NOTES,
  formatReleaseNoteDate,
  type ReleaseNote,
} from "@repo/validation";
import { SectionLabel } from "@/components/shared/section-label";
import { WhatsNewSeen } from "@/components/whats-new/whats-new-seen";

/**
 * What's new: the app's changes in members' words, newest first, opened from
 * the account menu. The newest entries also open by themselves once after an
 * update (`whats-new-host.tsx`). The list is `RELEASE_NOTES` in `@repo/validation`, the
 * same one mobile's Settings → What's new shows and `npm run release-notes`
 * prints for testers. One column on the page surface, a date label over each
 * entry's title and its lines (the Page grammar: no wrapper card).
 */
export function WhatsNew() {
  return (
    <div className="max-w-2xl space-y-10">
      {/* Reading the page is seeing the notes: clears the account menu's mark. */}
      <WhatsNewSeen />
      {RELEASE_NOTES.map((note) => (
        <ReleaseNoteEntry key={note.date} note={note} idPrefix="whats-new" />
      ))}
    </div>
  );
}

/**
 * One entry: its date label, title and lines. `idPrefix` keeps the label ids
 * apart when the page and the dialog (`whats-new-host.tsx`) are both mounted.
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
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground marker:text-muted">
        {note.changes.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
    </section>
  );
}
