import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { statusOf } from "@repo/api-sdk";
import {
  useAiSuggestions,
  useMeeting,
  useMeetingDraft,
  useMeetingRecording,
  useMemberDisplayNames,
  usePostMeeting,
  type MeetingMinutes,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  MEETING_COPY,
  MEETING_LIST_COPY,
  MEETING_NOTES_COPY,
  MEETING_RECORDER_COPY,
  isMeetingContentEmpty,
  meetingDayLabel,
  meetingTypeLabel,
  meetingWhenLabel,
  readMeetingContent,
  type MeetingType,
  isBetaOffModule,
} from "@repo/validation";
import type { BackTarget } from "@/components/back-row";
import { InlineNote } from "@/components/inline-note";
import { ListRow, ListSection } from "@/components/list-section";
import { MinutesBody } from "@/components/minutes/minutes-body";
import {
  NotesPanel,
  type NotesPanelHandle,
} from "@/components/minutes/notes-panel";
import {
  RecorderControls,
  RecorderStage,
  useMeetingRecorderRow,
} from "@/components/minutes/recorder";
import { RecordingPlayer } from "@/components/minutes/recording-player";
import { TranscriptLines } from "@/components/minutes/transcript-lines";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import { SheetPrimaryButton } from "@/components/sheet-scaffold";
import {
  ErrorState,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { StatusChip } from "@/components/status-chip";
import { useAiSurfaces } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import { recorderMeetingId } from "@/lib/minutes/recorder/machine";
import {
  recorderBusy,
  recordingPipeline,
} from "@/lib/minutes/recorder/row-view";
import { useMeetingRecorder } from "@/lib/minutes/recorder/session";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One meeting's minutes (`spec/behavior/meetings.md`; #4312): what a member
 * opens from the "minutes posted" notification, an event, an Ask source, or
 * the Minutes list.
 *
 * **Everyone reads.** The page is the minutes as a document: the event's
 * name, what kind of meeting and when, then each section.
 *
 * **An officer who may edit a draft takes and finishes it here, on one
 * screen** (Paul, 2026-11-17: "I don't want a pop-up sheet for everything").
 * From the top: the recorder's stage (a big running clock while it records,
 * then four steps ticking off to a draft), the minutes to review once they
 * are in, and the officer's own notes, typed in place. The one action of the
 * moment is pinned at the bottom: pause and stop while recording, Post once
 * there is something to post, Draft minutes for typed notes, Record the
 * meeting to begin. A finished transcript drafts by itself, so after Stop
 * the minutes arrive without another press. Changing a section's wording by
 * hand is still on the web (the phone has no section editor yet).
 *
 * Posting asks nothing first, as on the web (Paul, 2026-11-16), though it
 * tells every invited member once.
 */
const BACK_TO_MINUTES: BackTarget = { label: "Minutes", href: "/minutes" };

export default function MinutesDetailsScreen() {
  // More, the event row and the push all hide while `meetings` is off for the
  // beta; this catches a way in that skips them (a typed link), where the
  // server would only refuse. A chapter's own switch doesn't close the
  // screen, so minutes already posted stay readable from a notification.
  if (isBetaOffModule("meetings")) return <Redirect href="/you" />;
  return <MinutesDetailsScreenBody />;
}

function MinutesDetailsScreenBody() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    record?: string | string[];
  }>();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");
  const record =
    (Array.isArray(params.record) ? params.record[0] : params.record) === "1";
  const meetingQuery = useMeeting(id || null);

  if (!id) {
    return (
      <ScreenShell back={BACK_TO_MINUTES} title={MEETING_LIST_COPY.title}>
        <InlineNote>{MEETING_COPY.missingBody}</InlineNote>
      </ScreenShell>
    );
  }
  if (meetingQuery.isPending) {
    return (
      <ScreenShell back={BACK_TO_MINUTES} title={MEETING_LIST_COPY.title}>
        <MinutesSkeleton />
      </ScreenShell>
    );
  }
  if (!meetingQuery.data) {
    // A 404 is minutes that were deleted or aren't shared with this member;
    // anything else may pass on a retry.
    const missing = statusOf(meetingQuery.error) === 404;
    return (
      <ScreenShell back={BACK_TO_MINUTES} title={MEETING_LIST_COPY.title}>
        <ErrorState
          title={
            missing ? MEETING_COPY.missingTitle : MEETING_COPY.loadFailedTitle
          }
          body={
            missing ? MEETING_COPY.missingBody : MEETING_COPY.loadFailedBody
          }
          onRetry={missing ? undefined : () => void meetingQuery.refetch()}
          isRetrying={meetingQuery.isFetching}
        />
      </ScreenShell>
    );
  }
  return (
    <LoadedMinutes
      meeting={meetingQuery.data}
      autoRecord={record}
      refetch={async () => (await meetingQuery.refetch()).data ?? null}
    />
  );
}

function LoadedMinutes({
  meeting,
  autoRecord,
  refetch,
}: {
  meeting: MeetingMinutes;
  /** Opened by the event's or the +'s Record: ask to record straight away. */
  autoRecord: boolean;
  refetch: () => Promise<MeetingMinutes | null>;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const router = useRouter();
  const names = useMemberDisplayNames();
  const notesRef = useRef<NotesPanelHandle>(null);
  const post = usePostMeeting();
  const [problem, setProblem] = useState<string | null>(null);
  const [draftable, setDraftable] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const isDraft = meeting.status === "draft";
  const finishing = isDraft && meeting.can_edit;
  // Offered where the server has AI and the president has drafting on, which
  // is what the draft routes check; with either off the button would only
  // meet a refusal.
  const ai = useAiSurfaces();
  const notesOffered = ai.meetingNotes;
  const draftQuery = useMeetingDraft(meeting.id, {
    enabled: finishing && notesOffered,
  });
  const draftState = (notesOffered ? draftQuery.data : null) ?? null;
  const drafting = draftState?.status === "drafting";

  // The recorder is offered with drafting, which is what a transcript is for,
  // and only where the server can transcribe.
  const recordingQuery = useMeetingRecording(meeting.id, {
    enabled: finishing && notesOffered,
  });
  const recordingState =
    (finishing && notesOffered ? recordingQuery.data : null) ?? null;
  const recorderOffered = recordingState?.available === true;
  const { ensureConsent, consentSheet } = useAiConsentGate();
  const recorder = useMeetingRecorderRow({
    meetingId: meeting.id,
    eventName: meeting.event_name,
    server: recorderOffered ? recordingState : null,
    ensureConsent,
    autoRecord,
  });
  // A recording this phone holds for this meeting always has its controls
  // here, whatever the server says or hasn't said yet: the pill steps aside
  // on this screen, so without them an open microphone would have no Stop.
  const recorderState = useMeetingRecorder().state;
  const heldHere = recorderMeetingId(recorderState) === meeting.id;
  const recorderShown = (recorderOffered || heldHere) && recorder.shown;
  const busy = recorderBusy(meeting.id, recorderState, recordingState);
  const transcript =
    recordingState?.status === "ready" ? recordingState.transcript : null;
  const steps = recordingPipeline(meeting.id, recorderState, recordingState, {
    drafting,
  });

  // The tasks suggested from these minutes, for someone who could accept
  // them. Read only once the minutes are posted, which is what makes them.
  const suggestions = useAiSuggestions({
    source: { type: "meeting", id: meeting.id },
    enabled: !isDraft && ai.available === true,
  });
  const suggested = (suggestions.data?.items ?? []).filter(
    (item) => item.kind === "task" && item.task !== null,
  ).length;

  const content = useMemo(
    () => readMeetingContent(meeting.content),
    [meeting.content],
  );
  const empty = isMeetingContentEmpty(content);

  const meetingRefresh = useCallback(() => refetch(), [refetch]);
  const refresh = useRefetchAll([
    { refetch: meetingRefresh },
    draftQuery,
    recordingQuery,
    suggestions,
  ]);

  async function handlePost() {
    setProblem(null);
    // No "are you sure" (Paul, 2026-11-16): posting is the officer's plain
    // intent, and posted minutes can still be edited.
    // No section is edited on the phone, so the version to post is whatever
    // the server holds now: the one this member just read.
    const fresh = await refetch();
    if (!fresh) {
      setProblem(MEETING_COPY.postFailed);
      return;
    }
    try {
      await post.mutateAsync({
        id: meeting.id,
        expectedUpdatedAt: fresh.updated_at,
      });
    } catch (error) {
      setProblem(errorCopy(error, MEETING_COPY.postFailed));
    }
  }

  const type = meetingTypeLabel(
    meeting.meeting_type as MeetingType,
    meeting.other_label,
  );

  // The one thing at the bottom (Paul, 2026-11-17): the recorder's controls
  // while it records or needs the officer, else Post once the minutes have
  // words, else Draft minutes once there is something to draft from, else
  // the recorder's quieter steps (Record, Open Settings after a refusal),
  // which never stand in the way of posting.
  const recorderFooter =
    recorderShown && (recorder.view.live || recorder.primary) ? (
      <RecorderControls row={recorder} />
    ) : null;
  const recordLeads = recorder.primary?.does === "record";
  const recorderLeads =
    !!recorder.view.live ||
    (!!recorder.primary &&
      recorder.primary.does !== "record" &&
      recorder.primary.does !== "open_settings");
  let footer: ReactNode = null;
  if (finishing || heldHere) {
    if (recorderFooter && recorderLeads) footer = recorderFooter;
    else if (finishing && !busy && !drafting && !empty) {
      footer = (
        <SheetPrimaryButton
          label={MEETING_COPY.post}
          busy={post.isPending}
          disabled={post.isPending}
          onPress={() => void handlePost()}
          accent={accent}
          onAccent={accentOnPrimary}
        />
      );
    } else if (finishing && draftState && draftable && !busy && !drafting) {
      footer = (
        <SheetPrimaryButton
          label={MEETING_NOTES_COPY.draft}
          onPress={() => void notesRef.current?.draft()}
          accent={accent}
          onAccent={accentOnPrimary}
        />
      );
    } else if (recorderFooter) footer = recorderFooter;
  }

  return (
    <>
      <ScreenShell
        back={BACK_TO_MINUTES}
        title={meeting.event_name}
        subtitle={`${type} meeting, ${meetingWhenLabel(meeting.event_start_time)}`}
        refresh={refresh}
        keyboardShouldPersistTaps="handled"
        footer={
          footer || problem ? (
            <>
              {problem ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.meta, styles.problem]}
                >
                  {problem}
                </Text>
              ) : null}
              {footer}
            </>
          ) : undefined
        }
      >
        <View style={styles.stateRow}>
          {isDraft ? (
            <StatusChip
              label={MEETING_COPY.draftBadge}
              hue={tokens.color.semantic.warning}
            />
          ) : (
            <Text style={styles.meta}>
              {MEETING_COPY.posted(meetingDayLabel(meeting.posted_at))}
            </Text>
          )}
        </View>

        {recorderShown ? <RecorderStage row={recorder} steps={steps} /> : null}

        {/* The minutes themselves: the draft to review once it is in. While
            the recorder works and nothing is written there is nothing to
            show, so the stage above has the screen. */}
        {empty && finishing && (busy || recordLeads || drafting) ? null : (
          <MinutesBody
            meeting={meeting}
            content={content}
            nameFor={names.nameFor}
          />
        )}

        {/* Nothing to write with here: no drafting, so no notes or recorder. */}
        {finishing && empty && !notesOffered ? (
          <Text style={styles.meta}>{MEETING_COPY.writeOnWeb}</Text>
        ) : null}

        {finishing && draftState ? (
          <NotesPanel
            ref={notesRef}
            meetingId={meeting.id}
            eventStart={meeting.event_start_time}
            state={draftState}
            hasContent={!empty}
            recording={recorderOffered ? recordingState : null}
            getVersion={async () => (await refetch())?.updated_at ?? null}
            onSettled={() => void refetch()}
            autoDraft={!!transcript && empty}
            onDraftable={setDraftable}
          />
        ) : null}

        {transcript && recordingState ? (
          <View style={styles.transcript}>
            {recordingState.audio_url ? (
              <RecordingPlayer
                url={recordingState.audio_url}
                durationSeconds={recordingState.duration_seconds ?? 0}
              />
            ) : null}
            <ListSection>
              <ListRow
                label={MEETING_RECORDER_COPY.transcriptRow(
                  recordingState.duration_seconds ?? 0,
                )}
                value={transcriptOpen ? "Hide" : "Show"}
                onPress={() => setTranscriptOpen((open) => !open)}
              />
            </ListSection>
            {transcriptOpen ? <TranscriptLines transcript={transcript} /> : null}
          </View>
        ) : null}

        {/* Posted minutes keep their recording's transcript (#5410). */}
        {!transcript && meeting.transcript ? (
          <View style={styles.transcript}>
            <ListSection>
              <ListRow
                label={MEETING_COPY.transcript}
                value={transcriptOpen ? "Hide" : "Show"}
                onPress={() => setTranscriptOpen((open) => !open)}
              />
            </ListSection>
            {transcriptOpen ? (
              <TranscriptLines transcript={meeting.transcript} />
            ) : null}
          </View>
        ) : null}

        {/* Under the minutes, so its arrival after the read moves nothing
            the member is reading. */}
        {suggested > 0 ? (
          <ListSection>
            <ListRow
              label={MEETING_COPY.suggestedTasks}
              value={String(suggested)}
              accessibilityHint="Opens the tasks suggested from these minutes."
              onPress={() =>
                router.push({
                  pathname: "/suggested-tasks",
                  params: { meetingId: meeting.id },
                })
              }
            />
          </ListSection>
        ) : null}
      </ScreenShell>
      {recorder.sheets}
      {consentSheet}
    </>
  );
}

function MinutesSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { body, caption } = tokens.typography.role;
  return (
    <SkeletonRegion label="Loading minutes" style={styles.skeleton}>
      <SkeletonText role={caption} width="30%" />
      <SkeletonText role={body} width="92%" />
      <SkeletonText role={body} width="84%" />
      <SkeletonText role={body} width="60%" />
      <SkeletonText role={caption} width="34%" />
      <SkeletonText role={body} width="88%" />
      <SkeletonText role={body} width="70%" />
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    stateRow: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 24,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      color: tokens.color.semantic.destructiveText,
    },
    transcript: {
      gap: tokens.spacing.sm,
    },
    skeleton: {
      gap: tokens.spacing.md,
    },
  });
}
