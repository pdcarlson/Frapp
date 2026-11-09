import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useCurrentUser } from "@repo/hooks";
import {
  RELEASE_NOTES,
  decideWhatsNew,
  type ReleaseNote,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SHEET_STACK_BEHAVIOR,
  SheetScrim,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { ReleaseNoteCard } from "@/components/whats-new/release-note-card";
import { isTourDue } from "@/lib/onboarding/tour";
import { useFrappTheme } from "@/lib/theme";
import {
  readWhatsNewSeen,
  recordWhatsNewSeen,
  startWhatsNewBootRead,
} from "@/lib/whats-new";

/**
 * Opens What's new by itself, once, after an update brings a new entry or new
 * lines in the newest one (`lib/whats-new.ts` has the rule). Mounted in the
 * tab layout beside the first-run tour's host, so it never runs during
 * onboarding, which lives in the auth group, and it sits out any launch the
 * tour is due on.
 *
 * A tall sheet over whatever is on screen (the chat home, or the channel the
 * launch jumped into): its body scrolls and grows with every update a member
 * skipped, which `spec/ui/design-system/components.md` § Surface size gives
 * the full-height sheet with the X pinned in its header. It also closes by a
 * swipe, Android back and VoiceOver's escape. The full list stays in
 * Settings → What's new.
 *
 * The entry is recorded as seen once the sheet has been asked to present, so
 * a member who kills the app with it open isn't shown it again, and a sheet
 * that never presented burns nothing.
 */

/** Long enough for the launch jump into the last channel to finish sliding. */
export const WHATS_NEW_OPEN_DELAY_MS = 800;

export function WhatsNewHost() {
  const sheet = useRef<BottomSheetModal>(null);
  const closeSheet = useSheetClose(sheet);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();
  const userQuery = useCurrentUser();
  const userId = (userQuery.data as { id?: string } | undefined)?.id ?? null;
  const [shown, setShown] = useState<{
    notes: readonly ReleaseNote[];
    record: string;
  } | null>(null);
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
      const record = decision.record;
      if (!record) return;
      timer = setTimeout(() => {
        if (live) setShown({ notes: decision.show, record });
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
    if (!shown || !sheet.current) return;
    sheet.current.present();
    void recordWhatsNewSeen(shown.record);
  }, [shown]);

  return (
    <BottomSheetModal
      ref={sheet}
      {...tallSheet}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setShown(null)}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        style={styles.scroll}
        contentContainerStyle={styles.body}
        // The X stays pinned while a long list scrolls under it: at full
        // height there is no scrim to tap.
        stickyHeaderIndices={[0]}
      >
        <View style={styles.stickyHeader}>
          <TallSheetHeader title="What's new" onClose={closeSheet} />
        </View>
        {(shown?.notes ?? []).map((note) => (
          <ReleaseNoteCard key={note.date} note={note} />
        ))}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
    },
    stickyHeader: {
      // Sticky, so it paints the sheet's own fill over the notes passing under.
      backgroundColor: tokens.color.surface.popover,
    },
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
  });
}
