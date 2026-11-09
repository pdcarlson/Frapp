import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useCurrentUser } from "@repo/hooks";
import { RELEASE_NOTES, type ReleaseNote } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
} from "@/components/sheet-scaffold";
import { ReleaseNoteCard } from "@/components/whats-new/release-note-card";
import { isTourDue } from "@/lib/onboarding/tour";
import { useFrappTheme } from "@/lib/theme";
import {
  decideWhatsNew,
  readWhatsNewSeen,
  recordWhatsNewSeen,
  startWhatsNewBootRead,
} from "@/lib/whats-new";

/**
 * Opens What's new by itself, once, after an update brings a new entry
 * (`lib/whats-new.ts` has the rule). Mounted in the tab layout beside the
 * first-run tour's host, so it never runs during onboarding, which lives in
 * the auth group, and it sits out any launch the tour is due on.
 *
 * A read-only sheet over whatever is on screen: the chat home, or the channel
 * the launch jumped into. It closes like any other read-only sheet (a swipe,
 * the scrim, Android back, VoiceOver's escape), with no button of its own
 * (`spec/ui/design-system/components.md` § Chrome weight). The full list
 * stays in Settings → What's new.
 *
 * Showing it records it, before the sheet is up, so a member who kills the
 * app with it open isn't shown it again.
 */

/** Long enough for the launch jump into the last channel to finish sliding. */
export const WHATS_NEW_OPEN_DELAY_MS = 800;

/** Fixed detent with the scroll view as the modal's direct child. */
const SNAP_POINTS = ["75%"];

export function WhatsNewHost() {
  const sheet = useRef<BottomSheetModal>(null);
  const closeSheet = useSheetClose(sheet);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const userQuery = useCurrentUser();
  const userId = (userQuery.data as { id?: string } | undefined)?.id ?? null;
  const [notes, setNotes] = useState<readonly ReleaseNote[]>([]);
  // Once per process: a new entry only arrives with a new bundle.
  const checked = useRef(false);

  useEffect(() => {
    if (!userId || checked.current) return;
    checked.current = true;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const [existingInstall, seen, tourDue] = await Promise.all([
        startWhatsNewBootRead(),
        readWhatsNewSeen(),
        isTourDue(userId),
      ]);
      const decision = decideWhatsNew({
        notes: RELEASE_NOTES,
        seen,
        tourDue,
        existingInstall,
      });
      if (decision.show.length === 0) {
        if (decision.record) await recordWhatsNewSeen(decision.record);
        return;
      }
      timer = setTimeout(() => {
        if (!live) return;
        if (decision.record) void recordWhatsNewSeen(decision.record);
        setNotes(decision.show);
      }, WHATS_NEW_OPEN_DELAY_MS);
    })();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      // Unmounted mid-check (a sign-out, a chapter switch): the next mount
      // checks again, and nothing was recorded for a sheet never shown.
      checked.current = false;
    };
  }, [userId]);

  useEffect(() => {
    if (notes.length > 0) sheet.current?.present();
  }, [notes]);

  return (
    <BottomSheetModal
      ref={sheet}
      enableDynamicSizing={false}
      snapPoints={SNAP_POINTS}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setNotes([])}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.body}
      >
        <SheetHeader title="What's new" />
        {notes.map((note) => (
          <ReleaseNoteCard key={note.date} note={note} />
        ))}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
  });
}
