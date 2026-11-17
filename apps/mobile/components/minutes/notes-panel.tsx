import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { codeOf } from "@repo/api-sdk";
import {
  useDiscardMeetingDraft,
  useChooseMeetingDraftVersion,
  useCurrentUser,
  useMeetingNotes,
  useMemberDisplayNames,
  useRemoveMeetingRecording,
  useRequestMeetingDraft,
  useUseMeetingDraft,
  type MeetingDraftState,
  type MeetingRecordingState,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_REPORT_COPY,
  MEETING_DRAFT_FAILURE_COPY,
  MEETING_NOTES_COPY,
  MEETING_NOTES_MAX_LENGTH,
  MEETING_NOTE_TAKERS_COPY,
  STANDARDS_MEETING_NOTE,
  meetingLocalDay,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import {
  useAiReport,
  type AiReportTarget,
} from "@/components/ai/report-ai-sheet";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import { TextAction } from "@/components/minutes/recorder-controls";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  useDropKeptSheetDraft,
  useKeptSheetDraft,
  useKeptSheetOpening,
} from "@/lib/kept-sheet-draft";

/**
 * Notes kept past the minutes screen, with the stored notes they were typed
 * over: a kept copy comes back only while the server still holds those, so
 * notes cleared or replaced on web since aren't put back over theirs.
 */
interface KeptNotes {
  notes: string;
  base: string;
}
import { confirmAlert } from "@/lib/minutes/meetings-on";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The officer's notes and the draft written from them, on the minutes screen
 * itself (`spec/behavior/meetings.md` § Drafting from notes; #4312). Web's
 * twin is `notes-draft-panel.tsx`; both say the same words
 * (`MEETING_NOTES_COPY`) and call the same routes.
 *
 * On the screen, not in a sheet (Paul, 2026-11-17: "I don't want a pop-up
 * sheet for everything ... if I'm writing my notes, they should be on
 * screen"), the way Granola keeps its notes beside the recording: the officer
 * types under the running clock, and the draft that comes back fills in the
 * minutes above.
 *
 * Drafting is one action, not two doors to the same sheet. The screen's
 * button asks for it (`draft()`), and a finished transcript asks for it by
 * itself (`autoDraft`), so after Stop the minutes simply arrive. The AI
 * question is asked where a draft is first asked for.
 *
 * The phone has no section editor, so nothing typed elsewhere can be lost:
 * the version a draft builds on is read fresh from the server (`getVersion`)
 * each time one is asked for.
 *
 * A recording's transcript is a source of its own (§ Recording in the app,
 * #4935): the draft reads it beside the notes, so it never goes into the box.
 * Clearing the notes removes the recording with them, as web does.
 *
 * Notes are stored only when a draft is asked for, so what was typed before
 * then is kept past the minutes screen (`meeting-notes:<meetingId>`, #5041):
 * meeting notes are the costliest text in the app to lose to a back swipe.
 * Asking for a draft gives the kept copy up once the ask lands (the server
 * holds the notes then), and holds it out while the ask is in flight; Clear
 * gives it up too. Leaving the screen keeps it, as a back swipe does.
 * A kept copy comes back only over the stored notes it was typed over.
 */
export interface NotesPanelHandle {
  /** Asks for a draft from these notes and the transcript. */
  draft: () => Promise<void>;
}

export interface NotesPanelProps {
  meetingId: string;
  eventStart: string;
  state: MeetingDraftState;
  /** The minutes already hold something a draft would replace. */
  hasContent: boolean;
  /** The server's record of this meeting's recording, where one is read. */
  recording?: MeetingRecordingState | null;
  /** The minutes' current version, read fresh, or null when that failed. */
  getVersion: () => Promise<string | null>;
  /** A draft stopped being written, however it ended: read the minutes again. */
  onSettled: () => void;
  /**
   * A transcript is in and nothing is drafted yet: ask for the draft without
   * waiting for a press, once.
   */
  autoDraft?: boolean;
  /**
   * Whether there is anything to draft from (this officer's notes, another
   * note-taker's, or a transcript), for the screen's Draft button, so a
   * draft that failed can be asked for again.
   */
  onDraftable?: (draftable: boolean) => void;
}

export const NotesPanel = forwardRef<NotesPanelHandle, NotesPanelProps>(
  function NotesPanel(
  {
    meetingId,
    eventStart,
    state,
    hasContent,
    recording = null,
    getVersion,
    onSettled,
    autoDraft = false,
    onDraftable,
  },
  ref,
) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);

  const request = useRequestMeetingDraft();
  const discard = useDiscardMeetingDraft();
  const use = useUseMeetingDraft();
  const removeRecording = useRemoveMeetingRecording();
  const { ensureConsent, consentSheet } = useAiConsentGate();
  const reporting = useAiReport();
  const keptName = `meeting-notes:${meetingId}`;
  const stored = useKeptSheetOpening<KeptNotes>(keptName, {
    waitsOnSend: true,
  });
  const fits = stored !== undefined && stored.base === state.notes;
  const opening = fits ? stored : undefined;
  // Typed over notes the server no longer holds: it goes.
  useDropKeptSheetDraft(keptName, stored !== undefined && !fits);
  const [notes, setNotes] = useState(opening?.notes ?? state.notes);
  // The stored notes this visit's typing is over.
  const [base, setBase] = useState(state.notes);
  const kept = useKeptSheetDraft<KeptNotes>(
    keptName,
    { notes, base },
    undefined,
    opening,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  // Opened while an earlier visit's ask is still out (#5086): it shows what
  // that visit sent, held as the asking sheet holds it until the ask settles.
  const drafting =
    state.status === "drafting" ||
    request.isPending ||
    use.isPending ||
    kept.sendingElsewhere;
  // That ask landed: the server holds what this sheet shows, as it does after
  // a send from this visit.
  const [heardLanding, setHeardLanding] = useState(false);
  if (kept.landedElsewhere && !heardLanding) {
    setHeardLanding(true);
    // What was sent, as the sending visit takes it: the server stores it
    // trimmed.
    setBase(notes.trim());
  }
  // The draft read's `blocked` is as old as that read. What the member just
  // answered on the sheet, or what the server just refused, is newer.
  const [consentNow, setConsentNow] = useState<"agreed" | "required" | null>(
    null,
  );
  const needsConsent =
    consentNow === "required" ||
    (state.blocked === "consent_required" && consentNow !== "agreed");

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

  // Since #4935 the recording's transcript is a source of its own, read by
  // the draft beside everyone's notes, and is never put into this box.
  const notesState = useMeetingNotes(meetingId).data ?? null;
  const transcriptReady =
    recording?.status === "ready" && !!recording.transcript;
  const otherWriters = (notesState?.takers ?? []).filter(
    (taker) => taker.notes.trim() !== "" && taker.held === null,
  );
  const othersWrote = otherWriters.length > 0 || transcriptReady;
  const choose = useChooseMeetingDraftVersion();
  const viewer = useCurrentUser().data as { id?: string } | undefined;
  const myName = useMemberDisplayNames().nameFor(viewer?.id ?? "");
  const isMine = (from: string) => !!myName && from === myName;

  async function handleChoose(conflict: number, version: number) {
    const expected = await getVersion();
    if (!expected) {
      setProblem(MEETING_NOTE_TAKERS_COPY.chooseFailed);
      return;
    }
    try {
      await choose.mutateAsync({
        id: meetingId,
        body: { conflict, version, expected_updated_at: expected },
      });
      settled.current();
    } catch (error) {
      if (codeOf(error) === "meeting.stale") settled.current();
      setProblem(errorCopy(error, MEETING_NOTE_TAKERS_COPY.chooseFailed));
    }
  }

  async function handleDraft() {
    if (kept.sendingElsewhere) return;
    const text = notes.trim();
    if (!text && !othersWrote) {
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
        setConsentNow("agreed");
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
    // Out of the kept store until the ask lands or fails: the server holds
    // the notes once it lands.
    kept.hold();
    try {
      await request.mutateAsync({
        id: meetingId,
        body: {
          ...(text ? { notes: text } : {}),
          expected_updated_at: expected,
          meeting_date: meetingLocalDay(eventStart),
        },
      });
      kept.clear();
      // The server holds these notes now; what is typed next is over them.
      setBase(text);
    } catch (error) {
      kept.release();
      const code = codeOf(error);
      if (code === "meeting.standards_refused")
        setProblem(STANDARDS_MEETING_NOTE);
      else if (code === "ai.consent.required") {
        // Said No since the draft was read: the next press asks.
        setConsentNow("required");
        setProblem(MEETING_DRAFT_FAILURE_COPY.consent_required);
      } else if (code === "ai.chapter_off")
        setProblem(MEETING_DRAFT_FAILURE_COPY.chapter_off);
      else if (code === "meeting.stale") {
        // Someone saved on the web in the moment between the read and the
        // ask. Nothing here is lost; the next press reads the new version.
        settled.current();
        setProblem(MEETING_NOTES_COPY.startFailed);
      } else setProblem(errorCopy(error, MEETING_NOTES_COPY.startFailed));
    }
  }

  useImperativeHandle(ref, () => ({ draft: handleDraft }));

  const draftable = notes.trim() !== "" || othersWrote;
  const draftableReported = useRef<boolean | null>(null);
  useEffect(() => {
    if (draftableReported.current === draftable) return;
    draftableReported.current = draftable;
    onDraftable?.(draftable);
  }, [draftable, onDraftable]);

  // A transcript just came in for minutes with nothing drafted: draft now.
  const autoAsked = useRef(false);
  const autoReady =
    autoDraft &&
    !drafting &&
    state.status === "none" &&
    !needsConsent &&
    !kept.sendingElsewhere;
  useEffect(() => {
    if (!autoReady || autoAsked.current) return;
    autoAsked.current = true;
    void handleDraft();
    // handleDraft reads the latest notes through the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReady]);

  async function handleStop() {
    // Only the writing stops: the notes stay, stored and in the box.
    try {
      await discard.mutateAsync({ id: meetingId, keepNotes: true });
    } catch (error) {
      setProblem(errorCopy(error, MEETING_NOTES_COPY.stopFailed));
    }
  }

  async function handleClear() {
    const hasRecording = recording !== null && recording.status !== "none";
    const yes = await confirmAlert({
      title: MEETING_NOTES_COPY.clearTitle,
      body: hasRecording
        ? MEETING_NOTES_COPY.clearBodyRecording
        : MEETING_NOTES_COPY.clearBody,
      confirmLabel: MEETING_NOTES_COPY.clear,
      destructive: true,
    });
    if (!yes) return;
    try {
      // The officer's own notes and the draft; other note-takers' stay theirs.
      await discard.mutateAsync({ id: meetingId });
      // The recording is the officer's upload: Clear notes removes it too.
      if (hasRecording) await removeRecording.mutateAsync({ id: meetingId });
      kept.clear();
      setNotes("");
      setBase("");
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
      ? {
          problem: false,
          text: othersWrote
            ? MEETING_NOTE_TAKERS_COPY.draftingAll
            : MEETING_NOTES_COPY.drafting,
        }
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
              ? {
                  problem: false,
                  text: othersWrote
                    ? MEETING_NOTE_TAKERS_COPY.appliedAll
                    : MEETING_NOTES_COPY.applied,
                }
              : { problem: false, text: "" };

  const reviewed = state.status === "applied" || state.status === "ready";
  const { gaps, left_out: leftOut } = state.review;
  // An API from before several note-takers sends no disagreements.
  const conflicts = state.review.conflicts ?? [];
  const canClear = !drafting && (notes !== "" || state.status !== "none");
  const clearing = discard.isPending || removeRecording.isPending;
  // A draft the AI wrote can be reported, like an Ask answer. Each draft is
  // its own thing to report.
  const reportTarget: AiReportTarget = {
    subject: "meeting_draft",
    subjectId: meetingId,
    version: state.requested_at ?? null,
  };
  const draftReported = reporting.isReported(reportTarget);

  return (
    <View style={styles.panel}>
      <TextInput
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
        style={[
          styles.field,
          styles.fieldMultilineText,
          styles.notes,
          focused ? styles.fieldFocused : null,
        ]}
      />
      {status.text ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.status, status.problem ? styles.problem : null]}
        >
          {status.text}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {drafting ? (
          <TextAction
            label={MEETING_NOTES_COPY.stop}
            color={tokens.color.text.mutedForeground}
            disabled={
              discard.isPending || request.isPending || kept.sendingElsewhere
            }
            onPress={() => void handleStop()}
          />
        ) : null}
        {waiting ? (
          <TextAction
            label={MEETING_NOTES_COPY.useDraft}
            color={accent}
            disabled={use.isPending}
            onPress={() => void handleUse()}
          />
        ) : null}
        {!drafting && (reviewed || waiting) ? (
          <TextAction
            label={MEETING_NOTES_COPY.draftAgain}
            color={accent}
            onPress={() => void handleDraft()}
          />
        ) : null}
        {canClear ? (
          <TextAction
            label={MEETING_NOTES_COPY.clear}
            color={tokens.color.text.mutedForeground}
            disabled={clearing}
            onPress={() => void handleClear()}
          />
        ) : null}
      </View>

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

      {reviewed && !drafting && conflicts.length > 0 ? (
        <View style={styles.review}>
          <Text accessibilityRole="header" style={styles.reviewHead}>
            {MEETING_NOTE_TAKERS_COPY.disagreed}
          </Text>
          {conflicts.map((conflict, index) => (
            <View key={index} style={styles.conflict}>
              <Text style={styles.settled}>
                {conflict.settled_by
                  ? MEETING_NOTE_TAKERS_COPY.settledBy[conflict.settled_by]
                  : MEETING_NOTE_TAKERS_COPY.youDecide}
              </Text>
              <Text style={styles.gap}>{conflict.about}</Text>
              {conflict.versions.map((version, at) => (
                <View key={at} style={styles.version}>
                  <Text style={styles.gap}>{version.text}</Text>
                  <Text style={styles.hint}>
                    {`${MEETING_NOTE_TAKERS_COPY.from(version.from, isMine(version.from))}: “${version.quote}”`}
                  </Text>
                  {conflict.chosen === at ? (
                    <Text style={styles.hint}>
                      {MEETING_NOTE_TAKERS_COPY.inMinutes}
                    </Text>
                  ) : state.status === "applied" ? (
                    <OnboardingSecondaryButton
                      fill
                      label={
                        conflict.chosen === null
                          ? MEETING_NOTE_TAKERS_COPY.pickVersion(
                              version.from,
                              isMine(version.from),
                            )
                          : MEETING_NOTE_TAKERS_COPY.takeVersion(
                              version.from,
                              isMine(version.from),
                            )
                      }
                      disabled={choose.isPending}
                      onPress={() => void handleChoose(index, at)}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {/* Last, so it turning into "Reported" moves nothing. */}
      {reviewed && !drafting && reporting.offered ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            draftReported
              ? AI_REPORT_COPY.reported
              : AI_REPORT_COPY.titles.meeting_draft
          }
          accessibilityState={draftReported ? { disabled: true } : undefined}
          disabled={draftReported}
          onPress={() => reporting.report(reportTarget)}
          style={({ pressed }) => [styles.report, pressed ? styles.pressed : null]}
        >
          <Text style={styles.reportText}>
            {draftReported ? AI_REPORT_COPY.reported : AI_REPORT_COPY.action}
          </Text>
        </Pressable>
      ) : null}
      {consentSheet}
      {reporting.reportSheet}
    </View>
  );
  },
);

function createStyles(tokens: SignetTokens, accent: string) {
  const caption = typeRole(tokens.typography.role.caption);
  return StyleSheet.create({
    ...sheetFieldStyles(tokens, accent),
    panel: {
      gap: tokens.spacing.sm,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.lg,
    },
    hint: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    notes: {
      minHeight: 120,
    },
    status: {
      ...caption,
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
    conflict: {
      gap: tokens.spacing.xs,
      paddingVertical: tokens.spacing.sm,
    },
    settled: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.warning,
    },
    version: {
      gap: tokens.spacing.xs,
      paddingLeft: tokens.spacing.sm,
    },
    report: {
      alignSelf: "center",
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
    },
    reportText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
