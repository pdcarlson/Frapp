import { forwardRef, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import {
  useCurrentUser,
  useMeetingNotes,
  useRemoveMeetingNoteTaker,
  useSaveMeetingNotes,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  MEETING_NOTES_COPY,
  MEETING_NOTES_MAX_LENGTH,
  MEETING_NOTE_TAKERS_COPY,
} from "@repo/validation";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";
import { confirmAlert } from "@/lib/minutes/meetings-on";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** How long typing rests before it is saved. */
const SAVE_AFTER_MS = 800;

type Status = "idle" | "saving" | "saved" | "failed";

/**
 * A note-taker's own notes on someone else's minutes, on the phone
 * (`spec/behavior/meetings.md` § Several note-takers, #4935). Web's twin is
 * the `/meetings/:id/notes` page; both say the same words
 * (`MEETING_NOTE_TAKERS_COPY`).
 *
 * The notes save as they are typed, so a phone set down mid-meeting loses
 * nothing; closing the sheet sends whatever is still waiting. Nothing of the
 * minutes shows here: a draft stays its author's until it is posted.
 */
export const NoteTakerSheet = forwardRef<
  BottomSheetModal,
  { meetingId: string }
>(function NoteTakerSheet({ meetingId }, ref) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const closeSheet = useSheetClose(ref);
  const query = useMeetingNotes(meetingId);
  const state = query.data ?? null;

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tall}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        stickyHeaderIndices={[0]}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TallSheetHeader
            title={
              state
                ? MEETING_NOTE_TAKERS_COPY.noteTakerTitle(
                    state.meeting.event_name,
                  )
                : MEETING_NOTE_TAKERS_COPY.takeNotes
            }
            onClose={closeSheet}
          />
        </View>
        {state ? (
          <NoteTakerNotes
            key={state.meeting.id}
            meetingId={meetingId}
            initial={state.mine.notes}
            author={state.meeting.author_name}
            others={state.others_count}
            held={state.mine.held === "consent_required"}
            onLeft={closeSheet}
          />
        ) : (
          <Text style={styles.hint}>
            {query.isPending ? "" : MEETING_NOTE_TAKERS_COPY.missing}
          </Text>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function NoteTakerNotes({
  meetingId,
  initial,
  author,
  others,
  held,
  onLeft,
}: {
  meetingId: string;
  initial: string;
  author: string;
  others: number;
  held: boolean;
  onLeft: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const save = useSaveMeetingNotes();
  const remove = useRemoveMeetingNoteTaker();
  const me = (useCurrentUser().data as { id?: string } | undefined)?.id;
  const [notes, setNotes] = useState(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [focused, setFocused] = useState(false);
  const saved = useRef(initial);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutate = useRef(save.mutateAsync);
  useEffect(() => {
    mutate.current = save.mutateAsync;
  });

  async function persist(value: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    if (value === saved.current) return;
    setStatus("saving");
    try {
      await mutate.current({ id: meetingId, notes: value });
      saved.current = value;
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  }

  // Closing the sheet within the pause before a save sends what was typed.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const value = pending.current;
      if (value !== null && value !== saved.current) {
        void mutate.current({ id: meetingId, notes: value }).catch(() => {});
      }
    },
    [meetingId],
  );

  async function handleLeave() {
    if (!me) return;
    const yes = await confirmAlert({
      title: MEETING_NOTE_TAKERS_COPY.leaveTitle,
      body: MEETING_NOTE_TAKERS_COPY.leaveBody,
      confirmLabel: MEETING_NOTE_TAKERS_COPY.leave,
      destructive: true,
    });
    if (!yes) return;
    try {
      if (timer.current) clearTimeout(timer.current);
      pending.current = null;
      await remove.mutateAsync({ id: meetingId, userId: me });
      onLeft();
    } catch {
      setStatus("failed");
    }
  }

  const line =
    status === "saving"
      ? MEETING_NOTE_TAKERS_COPY.saving
      : status === "saved"
        ? MEETING_NOTE_TAKERS_COPY.saved
        : status === "failed"
          ? MEETING_NOTE_TAKERS_COPY.saveFailed
          : MEETING_NOTE_TAKERS_COPY.noteTakerOthers(others);

  return (
    <>
      <Text style={styles.hint}>
        {MEETING_NOTE_TAKERS_COPY.noteTakerHint(author)}
      </Text>
      {held ? (
        <Text style={styles.hint}>
          {MEETING_NOTE_TAKERS_COPY.noteTakerConsent}
        </Text>
      ) : null}
      <BottomSheetTextInput
        multiline
        value={notes}
        onChangeText={(text) => {
          setNotes(text);
          if (timer.current) clearTimeout(timer.current);
          if (text.length > MEETING_NOTES_MAX_LENGTH) return;
          pending.current = text;
          timer.current = setTimeout(() => void persist(text), SAVE_AFTER_MS);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (pending.current !== null) void persist(pending.current);
        }}
        placeholder={MEETING_NOTES_COPY.placeholder}
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel={MEETING_NOTES_COPY.heading}
        style={[
          styles.field,
          styles.fieldMultilineText,
          styles.notes,
          focused ? styles.fieldFocused : null,
        ]}
      />
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.status, status === "failed" ? styles.problem : null]}
      >
        {line}
      </Text>
      <OnboardingSecondaryButton
        fill
        label={MEETING_NOTE_TAKERS_COPY.leave}
        disabled={remove.isPending || !me}
        onPress={() => void handleLeave()}
      />
    </>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    ...sheetFieldStyles(tokens, accent),
    body: {
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
    },
    header: {
      backgroundColor: tokens.color.surface.popover,
    },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    notes: {
      minHeight: 220,
    },
    status: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      minHeight: 20,
    },
    problem: {
      color: tokens.color.semantic.destructiveText,
    },
  });
}
