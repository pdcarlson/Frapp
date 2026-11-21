import { RELEASE_NOTES } from "@repo/validation";
import { ReleaseNoteEntry } from "@/components/whats-new/release-note-entry";
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
