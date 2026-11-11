import { useEffect } from "react";
import { useRecordWhatsNewSeen } from "@repo/hooks";
import { RELEASE_NOTES, releaseNoteVersion } from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_SETTINGS } from "@/components/back-row";
import { ReleaseNoteCard } from "@/components/whats-new/release-note-card";
import { markWhatsNewRead } from "@/lib/whats-new";

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
 *
 * Opening it records the newest entry as read, on this phone and on the
 * account, and clears the mark Settings → What's new carries when another
 * device showed the entry first (#4043).
 */
export default function WhatsNewScreen() {
  const { mutate: recordOnAccount } = useRecordWhatsNewSeen();
  useEffect(() => {
    const newest = RELEASE_NOTES[0];
    if (!newest) return;
    const version = releaseNoteVersion(newest);
    void markWhatsNewRead(version);
    recordOnAccount(version);
    // Once per visit; `mutate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ScreenShell back={BACK_TO_SETTINGS} title="What's new">
      {RELEASE_NOTES.map((note) => (
        <ReleaseNoteCard key={note.date} note={note} />
      ))}
    </ScreenShell>
  );
}
