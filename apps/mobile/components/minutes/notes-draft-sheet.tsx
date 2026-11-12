import { forwardRef, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { codeOf } from "@repo/api-sdk";
import {
  useDiscardMeetingDraft,
  useRequestMeetingDraft,
  useUseMeetingDraft,
  type MeetingDraftState,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  MEETING_DRAFT_FAILURE_COPY,
  MEETING_NOTES_COPY,
  MEETING_NOTES_MAX_LENGTH,
  STANDARDS_MEETING_NOTE,
  meetingLocalDay,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/ai-consent-sheet";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetPrimaryButton,
  SheetScrim,
  TallSheetHeader,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { confirmAlert } from "@/lib/minutes/meetings-on";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Minutes drafted from an officer's notes, on the phone
 * (`spec/behavior/meetings.md` § Drafting from notes; #4312). The secretary
 * types or pastes what they wrote down during the meeting, asks for a draft,
 * and the minutes behind this sheet fill in for them to read and post. Web's
 * twin is `notes-draft-panel.tsx`; both say the same words
 * (`MEETING_NOTES_COPY`) and call the same routes.
 *
 * It is a tall sheet over the minutes, the way Apple Notes and Granola give
 * rough notes the whole screen: notes are long, and a half-height box would
 * scroll them in a window.
 *
 * One status line sits under the field and keeps its height in every state,
 * so nothing below it moves while a draft is written (principles P4). The AI
 * question is asked here, where the officer first reaches for the draft.
 *
 * The phone has no section editor, so nothing typed elsewhere can be lost:
 * the version a draft builds on is read fresh from the server (`getVersion`)
 * each time one is asked for.
 */
export interface NotesDraftSheetProps {
  meetingId: string;
  eventStart: string;
  state: MeetingDraftState;
  /** The minutes already hold something a draft would replace. */
  hasContent: boolean;
  /** The minutes' current version, read fresh, or null when that failed. */
  getVersion: () => Promise<string | null>;
  /** A draft stopped being written, however it ended: read the minutes again. */
  onSettled: () => void;
}

export const NotesDraftSheet = forwardRef<
  BottomSheetModal,
  NotesDraftSheetProps
>(function NotesDraftSheet(
  { meetingId, eventStart, state, hasContent, getVersion, onSettled },
  ref,
) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const closeSheet = useSheetClose(ref);

  const request = useRequestMeetingDraft();
  const discard = useDiscardMeetingDraft();
  const use = useUseMeetingDraft();
  const { ensureConsent, consentSheet } = useAiConsentGate();
  const [notes, setNotes] = useState(state.notes);
  const [problem, setProblem] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const drafting =
    state.status === "drafting" || request.isPending || use.isPending;
  const needsConsent = state.blocked === "consent_required";

  // Whenever a draft stops being written (put in, waiting, stopped, failed),
  // the minutes behind the sheet may be behind.
  const lastStatus = useRef(state.status);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  });
  useEffect(() => {
    if (lastStatus.current === state.status) return;
    const was = lastStatus.current;
    lastStatus.current = state.status;
    if (was === "drafting" || state.status === "applied") settled.current();
  }, [state.status]);

  async function handleDraft() {
    const text = notes.trim();
    if (!text) {
      setProblem(MEETING_NOTES_COPY.empty);
      return;
    }
    if (text.length > MEETING_NOTES_MAX_LENGTH) {
      setProblem(
        MEETING_NOTES_COPY.tooLong(MEETING_NOTES_MAX_LENGTH, text.length),
      );
      return;
    }
    setProblem(null);
    if (needsConsent) {
      try {
        // A No leaves everything as it was: the notes stay in the box.
        if (!(await ensureConsent())) return;
      } catch {
        setProblem(MEETING_NOTES_COPY.consentCheckFailed);
        return;
      }
    }
    if (hasContent) {
      const yes = await confirmAlert({
        title: MEETING_NOTES_COPY.replaceTitle,
        body: MEETING_NOTES_COPY.replaceBodyDraft,
        confirmLabel: MEETING_NOTES_COPY.draft,
      });
      if (!yes) return;
    }
    const expected = await getVersion();
    if (!expected) {
      setProblem(MEETING_NOTES_COPY.startFailed);
      return;
    }
    try {
      await request.mutateAsync({
        id: meetingId,
        body: {
          notes: text,
          expected_updated_at: expected,
          meeting_date: meetingLocalDay(eventStart),
        },
      });
    } catch (error) {
      const code = codeOf(error);
      if (code === "meeting.standards_refused")
        setProblem(STANDARDS_MEETING_NOTE);
      else if (code === "ai.consent.required")
        setProblem(MEETING_DRAFT_FAILURE_COPY.consent_required);
      else if (code === "ai.chapter_off")
        setProblem(MEETING_DRAFT_FAILURE_COPY.chapter_off);
      else if (code === "meeting.stale") {
        // Someone saved on the web in the moment between the read and the
        // ask. Nothing here is lost; the next press reads the new version.
        settled.current();
        setProblem(MEETING_NOTES_COPY.startFailed);
      } else setProblem(errorCopy(error, MEETING_NOTES_COPY.startFailed));
    }
  }

  async function handleStop() {
    // Only the writing stops: the notes stay, stored and in the box.
    try {
      await discard.mutateAsync({ id: meetingId, keepNotes: true });
    } catch (error) {
      setProblem(errorCopy(error, MEETING_NOTES_COPY.stopFailed));
    }
  }

  async function handleClear() {
    const yes = await confirmAlert({
      title: MEETING_NOTES_COPY.clearTitle,
      body: MEETING_NOTES_COPY.clearBody,
      confirmLabel: MEETING_NOTES_COPY.clear,
      destructive: true,
    });
    if (!yes) return;
    try {
      if (state.status !== "none") await discard.mutateAsync({ id: meetingId });
      setNotes("");
      setProblem(null);
    } catch (error) {
      setProblem(errorCopy(error, MEETING_NOTES_COPY.clearFailed));
    }
  }

  async function handleUse() {
    if (hasContent) {
      const yes = await confirmAlert({
        title: MEETING_NOTES_COPY.replaceTitle,
        body: MEETING_NOTES_COPY.replaceBodyUse,
        confirmLabel: MEETING_NOTES_COPY.useDraft,
      });
      if (!yes) return;
    }
    const expected = await getVersion();
    if (!expected) {
      setProblem(MEETING_NOTES_COPY.useFailed);
      return;
    }
    try {
      await use.mutateAsync({ id: meetingId, expectedUpdatedAt: expected });
    } catch (error) {
      if (codeOf(error) === "meeting.stale") settled.current();
      setProblem(errorCopy(error, MEETING_NOTES_COPY.useFailed));
    }
  }

  const waiting = state.status === "ready";
  const status: { problem: boolean; text: string } = problem
    ? { problem: true, text: problem }
    : drafting
      ? { problem: false, text: MEETING_NOTES_COPY.drafting }
      : needsConsent
        ? { problem: false, text: MEETING_DRAFT_FAILURE_COPY.consent_required }
        : state.status === "failed"
          ? {
              problem: state.failure !== "stopped",
              text: state.failure_message ?? MEETING_DRAFT_FAILURE_COPY.failed,
            }
          : waiting
            ? { problem: false, text: MEETING_NOTES_COPY.waiting }
            : state.status === "applied"
              ? { problem: false, text: MEETING_NOTES_COPY.applied }
              : { problem: false, text: MEETING_NOTES_COPY.idle };

  const reviewed = state.status === "applied" || state.status === "ready";
  const { gaps, left_out: leftOut } = state.review;
  const canClear = !drafting && (notes !== "" || state.status !== "none");

  return (
    <>
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
              title={MEETING_NOTES_COPY.heading}
              onClose={closeSheet}
            />
          </View>
          <Text style={styles.hint}>{MEETING_NOTES_COPY.hint}</Text>
          <BottomSheetTextInput
            multiline
            value={notes}
            editable={!drafting}
            onChangeText={(text) => {
              setNotes(text);
              if (problem) setProblem(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={MEETING_NOTES_COPY.placeholder}
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel={MEETING_NOTES_COPY.heading}
            accessibilityHint={MEETING_NOTES_COPY.hint}
            style={[
              styles.field,
              styles.fieldMultilineText,
              styles.notes,
              focused ? styles.fieldFocused : null,
            ]}
          />
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.status, status.problem ? styles.problem : null]}
          >
            {status.text}
          </Text>

          {drafting ? (
            <OnboardingSecondaryButton
              fill
              label={MEETING_NOTES_COPY.stop}
              busy={discard.isPending}
              disabled={discard.isPending || request.isPending}
              onPress={() => void handleStop()}
            />
          ) : waiting ? (
            <SheetPrimaryButton
              label={MEETING_NOTES_COPY.useDraft}
              busy={use.isPending}
              disabled={use.isPending}
              onPress={() => void handleUse()}
              accent={accent}
              onAccent={accentOnPrimary}
            />
          ) : (
            <SheetPrimaryButton
              label={
                reviewed
                  ? MEETING_NOTES_COPY.draftAgain
                  : MEETING_NOTES_COPY.draft
              }
              onPress={() => void handleDraft()}
              accent={accent}
              onAccent={accentOnPrimary}
            />
          )}
          {waiting ? (
            <OnboardingSecondaryButton
              fill
              label={MEETING_NOTES_COPY.draftAgain}
              onPress={() => void handleDraft()}
            />
          ) : null}
          {canClear ? (
            <OnboardingSecondaryButton
              fill
              label={MEETING_NOTES_COPY.clear}
              disabled={discard.isPending}
              onPress={() => void handleClear()}
            />
          ) : null}

          {reviewed && !drafting && (gaps.length > 0 || leftOut > 0) ? (
            <View style={styles.review}>
              <Text accessibilityRole="header" style={styles.reviewHead}>
                {MEETING_NOTES_COPY.toFillIn}
              </Text>
              {gaps.map((gap, index) => (
                <Text key={index} style={styles.gap}>
                  {`• ${gap}`}
                </Text>
              ))}
              {leftOut > 0 ? (
                <Text style={styles.hint}>
                  {MEETING_NOTES_COPY.leftOut(leftOut)}
                </Text>
              ) : null}
            </View>
          ) : null}
        </BottomSheetScrollView>
      </BottomSheetModal>
      {consentSheet}
    </>
  );
});

function createStyles(tokens: SignetTokens, accent: string) {
  const caption = typeRole(tokens.typography.role.caption);
  return StyleSheet.create({
    ...sheetFieldStyles(tokens, accent),
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
      gap: tokens.spacing.md,
    },
    header: {
      backgroundColor: tokens.color.surface.popover,
    },
    hint: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    notes: {
      minHeight: 220,
    },
    status: {
      ...caption,
      // Three lines whichever words it holds, so nothing under it moves.
      minHeight: (caption.lineHeight ?? 18) * 3,
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      color: tokens.color.semantic.destructiveText,
    },
    review: {
      gap: tokens.spacing.xs,
      paddingTop: tokens.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    reviewHead: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    gap: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
  });
}
