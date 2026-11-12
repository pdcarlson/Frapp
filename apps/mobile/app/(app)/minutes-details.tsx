import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
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
import { NotesDraftSheet } from "@/components/minutes/notes-draft-sheet";
import { RecordingRow } from "@/components/minutes/recording-row";
import { useAiConsentGate } from "@/components/ai/ai-consent-sheet";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
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
import { confirmAlert } from "@/lib/minutes/meetings-on";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One meeting's minutes (`spec/behavior/meetings.md`; #4312): what a member
 * opens from the "minutes posted" notification, an event, an Ask source, or
 * the Minutes list.
 *
 * **Everyone reads.** The page is the minutes as a document: the event's
 * name, what kind of meeting and when, then each section.
 *
 * **An officer who may edit a draft finishes it here.** The secretary's phone
 * is what they had in the meeting, so the two things they do right after are
 * on it: draft the minutes from their notes (`NotesDraftSheet`, shown only
 * where the server offers drafting), and post. Changing a section's wording
 * by hand is on the web, and the page says so in one line, because the web's
 * editor (decisions with vote counts, action items with owners and due days)
 * is a form built for a keyboard and has no phone twin yet.
 *
 * **And records the meeting here** (§ Recording in the app): above Draft
 * minutes, where the server offers transcription, `RecordingRow` is the
 * recorder for this meeting. The transcript becomes the notes the draft is
 * written from.
 *
 * Posting asks first, as web does: it tells every invited member once.
 */
const BACK_TO_MINUTES: BackTarget = { label: "Minutes", href: "/minutes" };

export default function MinutesDetailsScreen() {
  // More, the event row and the push all hide while `meetings` is off for the
  // beta; this catches a way in that skips them (a typed link), where the
  // server would only refuse. A chapter's own switch doesn't close the
  // screen, so minutes already posted stay readable from a notification.
  if (isBetaOffModule("meetings")) return <Redirect href="/more" />;
  return <MinutesDetailsScreenBody />;
}

function MinutesDetailsScreenBody() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");
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
          body={missing ? MEETING_COPY.missingBody : MEETING_COPY.loadFailedBody}
          onRetry={missing ? undefined : () => void meetingQuery.refetch()}
          isRetrying={meetingQuery.isFetching}
        />
      </ScreenShell>
    );
  }
  return (
    <LoadedMinutes
      meeting={meetingQuery.data}
      refetch={async () => (await meetingQuery.refetch()).data ?? null}
    />
  );
}

function LoadedMinutes({
  meeting,
  refetch,
}: {
  meeting: MeetingMinutes;
  refetch: () => Promise<MeetingMinutes | null>;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const router = useRouter();
  const names = useMemberDisplayNames();
  const notesRef = useRef<BottomSheetModal>(null);
  const post = usePostMeeting();
  const [problem, setProblem] = useState<string | null>(null);

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
  // The Draft button holds its place while its read is out, so Post never
  // moves under a thumb and the line below never says "web" and then changes.
  const draftLoading = finishing && notesOffered && draftQuery.isPending;

  // The recorder is offered with drafting, which is what a transcript is for,
  // and only where the server can transcribe.
  const recordingQuery = useMeetingRecording(meeting.id, {
    enabled: finishing && notesOffered,
  });
  const recordingState =
    (finishing && notesOffered ? recordingQuery.data : null) ?? null;
  const recorderOffered = recordingState?.available === true;
  const { ensureConsent, consentSheet } = useAiConsentGate();

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
    const yes = await confirmAlert({
      title: MEETING_COPY.postConfirmTitle,
      body: MEETING_COPY.postConfirmBody,
      confirmLabel: MEETING_COPY.post,
    });
    if (!yes) return;
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

  return (
    <>
      <ScreenShell
        back={BACK_TO_MINUTES}
        title={meeting.event_name}
        subtitle={`${type} meeting, ${meetingWhenLabel(meeting.event_start_time)}`}
        refresh={refresh}
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

        <MinutesBody
          meeting={meeting}
          content={content}
          nameFor={names.nameFor}
        />

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

        {finishing ? (
          <View style={styles.actions}>
            {recorderOffered && recordingState ? (
              <RecordingRow
                meetingId={meeting.id}
                eventName={meeting.event_name}
                server={recordingState}
                ensureConsent={ensureConsent}
                onOpenNotes={() => notesRef.current?.present()}
              />
            ) : null}
            {draftState || draftLoading ? (
              <OnboardingSecondaryButton
                fill
                label={drafting ? MEETING_NOTES_COPY.drafting : MEETING_NOTES_COPY.draft}
                disabled={!draftState}
                onPress={() => notesRef.current?.present()}
              />
            ) : null}
            <SheetPrimaryButton
              label={MEETING_COPY.post}
              busy={post.isPending}
              disabled={post.isPending || drafting || empty}
              accessibilityHint={
                empty ? MEETING_COPY.nothingWritten : undefined
              }
              onPress={() => void handlePost()}
              accent={accent}
              onAccent={accentOnPrimary}
            />
            {/* One line, always there for a draft's editor, that carries a
                failed post in its place, so nothing moves when one fails. */}
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.meta, problem ? styles.problem : null]}
            >
              {problem ??
                (empty && !draftState && !draftLoading
                  ? MEETING_COPY.writeOnWeb
                  : MEETING_COPY.editOnWeb)}
            </Text>
          </View>
        ) : null}
      </ScreenShell>
      {finishing && draftState ? (
        <NotesDraftSheet
          ref={notesRef}
          meetingId={meeting.id}
          eventStart={meeting.event_start_time}
          state={draftState}
          hasContent={!empty}
          recording={recorderOffered ? recordingState : null}
          getVersion={async () => (await refetch())?.updated_at ?? null}
          onSettled={() => void refetch()}
        />
      ) : null}
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
    actions: {
      gap: tokens.spacing.md,
    },
    skeleton: {
      gap: tokens.spacing.md,
    },
  });
}
