import { useRef } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useRemoveMeetingRecording,
  type MeetingRecordingState,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { MEETING_RECORDER_COPY } from "@repo/validation";
import { RecordingNoticeSheet } from "@/components/minutes/recording-notice-sheet";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import { SheetPrimaryButton } from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { confirmAlert } from "@/lib/minutes/meetings-on";
import {
  recordingRowView,
  type RowAction,
  type RowButton,
} from "@/lib/minutes/recorder/row-view";
import { useMeetingRecorder } from "@/lib/minutes/recorder/session";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Recording a meeting on the phone, on that meeting's minutes
 * (`spec/behavior/meetings.md` § Recording in the app).
 *
 * The secretary opens the meeting's draft minutes, sets the phone on the
 * table and taps Record. The notice comes first (`RecordingNoticeSheet`);
 * then this row is the recorder for the next hour or two: a red dot, the
 * word Recording and a running clock, with Pause and Stop. Stop uploads the
 * file and the row follows it to a transcript, which goes into Your notes
 * for drafting. Voice Memos and Otter are the model: one big obvious state,
 * two buttons, nothing to configure.
 *
 * The recorder itself lives above the screens (`lib/minutes/recorder`), so
 * leaving this screen, locking the phone or opening chat doesn't stop it;
 * `RecordingBar` shows it everywhere else.
 *
 * One block, one height, in every state (principles P4): the status line,
 * three lines of words, the progress track and the buttons each keep their
 * place whether or not they have anything to show, so Draft minutes and Post
 * below never move under a thumb.
 */
export function RecordingRow({
  meetingId,
  eventName,
  server,
  ensureConsent,
  onOpenNotes,
}: {
  meetingId: string;
  eventName: string;
  /** The server's record of this meeting's recording. */
  server: MeetingRecordingState;
  /** Asks the AI question when the officer hasn't answered it. */
  ensureConsent: () => Promise<boolean>;
  onOpenNotes: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { state, recorder } = useMeetingRecorder();
  const remove = useRemoveMeetingRecording();
  const noticeRef = useRef<BottomSheetModal>(null);

  const view = recordingRowView(meetingId, state, server);
  // A build that can't record still shows what the web uploaded.
  const offered = (button: RowButton | null) =>
    button && (recorder || button.does !== "record") ? button : null;
  const primary = offered(view.primary);
  const secondary = offered(view.secondary);
  if (!recorder && server.status === "none") return null;

  async function record() {
    recorder?.clearRefusal();
    if (server.blocked === "consent_required") {
      try {
        if (!(await ensureConsent())) return;
      } catch {
        return;
      }
    }
    if (server.status === "ready" || server.status === "transcribing") {
      const yes = await confirmAlert({
        title: MEETING_RECORDER_COPY.replaceTitle,
        body: MEETING_RECORDER_COPY.replaceBody,
        confirmLabel: MEETING_RECORDER_COPY.recordAgain,
      });
      if (!yes) return;
    }
    noticeRef.current?.present();
  }

  async function run(does: RowAction) {
    switch (does) {
      case "record":
        return record();
      case "pause":
        return recorder?.pause();
      case "resume":
        return recorder?.resume();
      case "stop": {
        const yes = await confirmAlert({
          title: MEETING_RECORDER_COPY.stopTitle,
          body: MEETING_RECORDER_COPY.stopBody,
          confirmLabel: MEETING_RECORDER_COPY.stop,
        });
        if (yes) await recorder?.stop();
        return;
      }
      case "upload":
        return recorder?.upload();
      case "cancel_upload":
        return recorder?.cancelUpload();
      case "delete": {
        const yes = await confirmAlert({
          title: MEETING_RECORDER_COPY.deleteTitle,
          body: MEETING_RECORDER_COPY.deleteBody,
          confirmLabel: MEETING_RECORDER_COPY.delete,
          destructive: true,
        });
        if (yes) await recorder?.discard();
        return;
      }
      case "open_settings":
        return void Linking.openSettings().catch(() => undefined);
      case "open_other":
        if (state.phase !== "idle") {
          router.push({
            pathname: "/minutes-details",
            params: { id: state.subject.meetingId },
          });
        }
        return;
      case "stop_transcribing": {
        const yes = await confirmAlert({
          title: MEETING_RECORDER_COPY.stopTranscribingTitle,
          body: MEETING_RECORDER_COPY.stopTranscribingBody,
          confirmLabel: MEETING_RECORDER_COPY.stopTranscribing,
          destructive: true,
        });
        if (yes) await remove.mutateAsync({ id: meetingId }).catch(() => undefined);
        return;
      }
      case "open_notes":
        return onOpenNotes();
    }
  }

  const dotColor =
    view.dot === "live"
      ? tokens.color.semantic.destructive
      : tokens.color.semantic.warning;

  return (
    <View style={styles.block}>
      <View
        style={styles.statusLine}
        accessible={view.title !== null}
        accessibilityLabel={
          view.title ? `${view.title}, ${view.clock ?? ""}` : undefined
        }
      >
        {view.title ? (
          <>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Text style={styles.title}>{view.title}</Text>
            <Text style={styles.clock}>{view.clock}</Text>
          </>
        ) : null}
      </View>
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.text, view.tone === "problem" ? styles.problem : null]}
      >
        {view.text}
      </Text>
      {/* Always in the layout, so the buttons never move when it fills. */}
      <View
        style={[styles.track, view.progress === null ? styles.hidden : null]}
        accessibilityRole={view.progress === null ? undefined : "progressbar"}
        accessibilityValue={
          view.progress === null
            ? undefined
            : { min: 0, max: 100, now: Math.floor(view.progress * 100) }
        }
        accessibilityElementsHidden={view.progress === null}
        importantForAccessibility={
          view.progress === null ? "no-hide-descendants" : "auto"
        }
      >
        <View
          style={[
            styles.fill,
            {
              width: `${Math.floor((view.progress ?? 0) * 100)}%`,
              backgroundColor: accent,
            },
          ]}
        />
      </View>
      <View style={styles.buttons}>
        {secondary ? (
          <View style={styles.button}>
            <OnboardingSecondaryButton
              fill
              label={secondary.label}
              disabled={remove.isPending}
              onPress={() => void run(secondary.does)}
            />
          </View>
        ) : null}
        {primary ? (
          <View style={styles.button}>
            {primary.does === "stop" || primary.does === "resume" ? (
              <SheetPrimaryButton
                label={primary.label}
                onPress={() => void run(primary.does)}
                accent={accent}
                onAccent={accentOnPrimary}
              />
            ) : (
              <OnboardingSecondaryButton
                fill
                label={primary.label}
                disabled={remove.isPending}
                onPress={() => void run(primary.does)}
              />
            )}
          </View>
        ) : null}
      </View>
      {recorder ? (
        <RecordingNoticeSheet
          ref={noticeRef}
          maxSeconds={server.max_seconds}
          onStart={() =>
            void recorder.start(
              { meetingId, eventName, maxSeconds: server.max_seconds },
              true,
            )
          }
        />
      ) : null}
    </View>
  );
}

const DOT_SIZE = 10;
const TRACK_HEIGHT = 4;

function createStyles(tokens: SignetTokens) {
  const caption = typeRole(tokens.typography.role.caption);
  const label = typeRole(tokens.typography.role.label);
  return StyleSheet.create({
    block: {
      gap: tokens.spacing.sm,
    },
    statusLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: 24,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
    },
    title: {
      ...label,
      color: tokens.color.text.foreground,
    },
    clock: {
      ...label,
      color: tokens.color.text.foreground,
      // Digits of one width, so the clock doesn't shiver as it counts.
      fontVariant: ["tabular-nums"],
    },
    text: {
      ...caption,
      // Three lines whichever words it holds, so nothing under it moves.
      minHeight: (caption.lineHeight ?? 18) * 3,
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      color: tokens.color.semantic.destructiveText,
    },
    track: {
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      overflow: "hidden",
      backgroundColor: tokens.color.border.input,
    },
    hidden: {
      opacity: 0,
    },
    fill: {
      height: TRACK_HEIGHT,
    },
    buttons: {
      flexDirection: "row",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    button: {
      flex: 1,
    },
  });
}
