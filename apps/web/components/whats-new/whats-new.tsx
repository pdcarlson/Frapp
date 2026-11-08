import { RELEASE_NOTES, formatReleaseNoteDate } from "@repo/validation";
import { SectionLabel } from "@/components/shared/section-label";

/**
 * What's new: the app's changes in members' words, newest first, opened from
 * the account menu. The list is `RELEASE_NOTES` in `@repo/validation`, the
 * same one mobile's Settings → What's new shows and `npm run release-notes`
 * prints for testers. One column on the page surface, a date label over each
 * entry's title and its lines (the Page grammar: no wrapper card).
 */
export function WhatsNew() {
  return (
    <div className="max-w-2xl space-y-10">
      {RELEASE_NOTES.map((note) => {
        const labelId = `whats-new-${note.date}`;
        return (
          <section
            key={note.date}
            aria-labelledby={labelId}
            className="space-y-3"
          >
            <SectionLabel id={labelId}>
              {formatReleaseNoteDate(note.date)}
            </SectionLabel>
            <h3 className="text-sm font-semibold text-foreground">
              {note.title}
            </h3>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground marker:text-muted">
              {note.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
