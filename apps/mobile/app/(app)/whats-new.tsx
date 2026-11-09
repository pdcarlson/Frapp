import { RELEASE_NOTES } from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_SETTINGS } from "@/components/back-row";
import { ReleaseNoteCard } from "@/components/whats-new/release-note-card";

/**
 * What's new: the app's changes in members' words, newest first, opened from
 * Settings. The list is `RELEASE_NOTES` in `@repo/validation`, the same one
 * web's account menu opens and `npm run release-notes` prints for testers, so
 * the three never say different things.
 *
 * Each entry is a date header over one card (`ReleaseNoteCard`). It ships in
 * the bundle, so it reads offline and an over-the-air update brings the new
 * entry with the code it describes. After such an update the new entries also
 * open by themselves, once, in a sheet (`components/whats-new/whats-new-host.tsx`).
 */
export default function WhatsNewScreen() {
  return (
    <ScreenShell back={BACK_TO_SETTINGS} title="What's new">
      {RELEASE_NOTES.map((note) => (
        <ReleaseNoteCard key={note.date} note={note} />
      ))}
    </ScreenShell>
  );
}
