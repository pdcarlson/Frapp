import { useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useRemoveMeetingRecording,
  type MeetingRecordingState,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { MEETING_RECORDER_COPY } from "@repo/validation";
import {
  CheckGlyph,
  MicGlyph,
  PauseGlyph,
  PlayGlyph,
  StopGlyph,
} from "@/components/control-glyphs";
import { RecordingNoticeSheet } from "@/components/minutes/recording-notice-sheet";
import {
  RoundControl,
  TextAction,
  WorkingBars,
} from "@/components/minutes/recorder-controls";
import { SheetPrimaryButton } from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { confirmAlert } from "@/lib/minutes/meetings-on";
import {
  recordingRowView,
  type PipelineStep,
  type RecordingRowView,
  type RowAction,
  type RowButton,
} from "@/lib/minutes/recorder/row-view";
import { meetingRecorderDevice } from "@/lib/minutes/recorder/device";
import { recorderMeetingId } from "@/lib/minutes/recorder/machine";
import { useMeetingRecorder } from "@/lib/minutes/recorder/session";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Recording a meeting on the phone, on that meeting's minutes
 * (`spec/behavior/meetings.md` § Recording in the app), rebuilt after Paul's
 * 2026-11-17 pass on the real screen: "Show me, not tell me ... literally
 * like a play, pause, and then like an indicator that shows it's recording."
 *
 * Voice Memos and Granola are the model. While it records, the recorder is
 * a bar pinned to the bottom (`RecorderControls`, #5288): pause, which turns
 * to carry on in the same place, the room's live level, the running clock and
 * stop, so the page above stays the officer's note to type in, keyboard up.
 * After Stop the page shows a card that ticks off four steps (`RecorderStage`),
 * recorded, uploaded, transcribed, drafted, so it is plain that nothing was
 * lost and where it is.
 * Rare states (a refusal, a recording kept on the phone) say why in one line
 * and offer their one way on.
 *
 * The recorder itself lives above the screens (`lib/minutes/recorder`), so
 * leaving this screen, locking the phone or opening chat doesn't stop it;
 * `RecordingBar` shows it everywhere else.
 */
export interface MeetingRecorderRow {
  /** Whether the screen draws the recorder at all. */
  shown: boolean;
  view: RecordingRowView;
  /** The one full-width button the recorder wants, or null. */
  primary: RowButton | null;
  actions: RowButton[];
  run: (does: RowAction) => Promise<void>;
  busy: boolean;
  /** The recording notice, mounted once by the screen. */
  sheets: ReactNode;
}

export function useMeetingRecorderRow({
  meetingId,
  eventName,
  server,
  ensureConsent,
  autoRecord = false,
}: {
  meetingId: string;
  eventName: string;
  /**
   * The server's record of this meeting's recording, or null when it has
   * none to give (the read is out or failed, or the minutes are posted). The
   * recorder still shows for a recording this phone holds: a microphone that
   * is open always has its Stop on this screen.
   */
  server: MeetingRecordingState | null;
  /** Asks the AI question when the officer hasn't answered it. */
  ensureConsent: () => Promise<boolean>;
  /** Ask to record as soon as it can, once (the event's Record minutes). */
  autoRecord?: boolean;
}): MeetingRecorderRow {
  const router = useRouter();
  const { state, recorder } = useMeetingRecorder();
  const remove = useRemoveMeetingRecording();
  const noticeRef = useRef<BottomSheetModal>(null);

  const view = recordingRowView(meetingId, state, server ?? NO_RECORD);
  // A build that can't record still shows what the web uploaded, and
  // nothing new is recorded for a meeting the server hasn't offered it on.
  const canRecord = !!(recorder && server);
  const offered = (button: RowButton | null) =>
    button && (canRecord || button.does !== "record") ? button : null;
  const primary = offered(view.primary);
  const actions = view.actions.filter((action) => offered(action));

  const autoAsked = useRef(false);
  const autoReady = autoRecord && canRecord && primary?.does === "record";
  useEffect(() => {
    if (!autoReady || autoAsked.current) return;
    autoAsked.current = true;
    void record();
    // record() reads the latest server state through the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReady]);

  async function record() {
    if (!server) return;
    recorder?.clearRefusal();
    if (server.blocked === "consent_required") {
      try {
        if (!(await ensureConsent())) return;
      } catch {
        return;
      }
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
        if (yes)
          await remove.mutateAsync({ id: meetingId }).catch(() => undefined);
        return;
      }
    }
  }

  const shown =
    (!!server || recorderMeetingId(state) !== null) &&
    !(!recorder && server?.status === "none");

  return {
    shown,
    view,
    primary,
    actions,
    run,
    busy: remove.isPending,
    sheets:
      recorder && server ? (
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
      ) : null,
  };
}

/**
 * The recorder's part of the page: the card of four steps after Stop, or one
 * line on why it needs the officer (a call took the microphone, a refusal, a
 * recording kept on the phone). While it records the bar at the bottom
 * (`RecorderControls`) says the rest.
 */
export function RecorderStage({
  row,
  steps,
}: {
  row: MeetingRecorderRow;
  steps: PipelineStep[] | null;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const { view } = row;

  // While it records the bar at the bottom says everything; the page keeps
  // only why it paused by itself (a call took the microphone).
  if (view.live) {
    return view.tone === "problem" ? (
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.line, styles.problem]}
      >
        {view.text}
      </Text>
    ) : null;
  }

  if (steps) {
    return (
      <View style={styles.steps}>
        {steps.map((step) => (
          <View
            key={step.key}
            style={styles.step}
            {...(step.progress !== null
              ? {
                  accessibilityRole: "progressbar" as const,
                  accessibilityValue: {
                    min: 0,
                    max: 100,
                    now: Math.floor(step.progress * 100),
                  },
                }
              : {})}
          >
            <View style={styles.stepMark}>
              {step.state === "done" ? (
                <View style={[styles.doneDot, { backgroundColor: accent }]}>
                  <CheckGlyph
                    color={tokens.color.surface.background}
                    size={14}
                  />
                </View>
              ) : step.state === "active" ? (
                <WorkingBars color={accent} />
              ) : (
                <View style={styles.waitDot} />
              )}
            </View>
            <Text
              style={[
                styles.stepLabel,
                step.state === "waiting" ? styles.stepWaiting : null,
              ]}
              accessibilityLabel={`${step.label}, ${step.state === "done" ? "done" : step.state === "active" ? "in progress" : "next"}`}
            >
              {step.label}
              {step.progress !== null
                ? `  ${Math.floor(step.progress * 100)}%`
                : ""}
            </Text>
          </View>
        ))}
        {row.actions.length > 0 ? (
          <View style={styles.actions}>
            {row.actions.map((action) => (
              <TextAction
                key={action.does}
                label={action.label}
                color={tokens.color.text.mutedForeground}
                disabled={row.busy}
                onPress={() => void row.run(action.does)}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  // A state that needs the officer (a refusal, a recording kept on this
  // phone, another meeting's recording): its one line and quiet steps. The
  // plain offer to record says nothing; its button at the bottom is enough.
  const quiet =
    view.primary?.does === "record" && view.tone === "quiet" && !view.title;
  if (quiet || (!view.text && row.actions.length === 0)) return null;
  if (view.title === MEETING_RECORDER_COPY.readyTitle) return null;
  return (
    <View style={styles.notice}>
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.line, view.tone === "problem" ? styles.problem : null]}
      >
        {view.text}
      </Text>
      {row.actions.length > 0 ? (
        <View style={styles.actions}>
          {row.actions.map((action) => (
            <TextAction
              key={action.does}
              label={action.label}
              color={accent}
              disabled={row.busy}
              onPress={() => void row.run(action.does)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The bottom of the screen while the recorder has it: a bar with pause or
 * carry on, the live level, the clock and stop, whose round icons never trade
 * places; or the recorder's one button (Record, Upload, Open Settings). Null when the recorder
 * wants nothing pressed, so the screen's own button (Post) can have the spot.
 */
export function RecorderControls({ row }: { row: MeetingRecorderRow }) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const { view, primary } = row;
  const ink = tokens.color.text.foreground;

  if (view.live) {
    const live = view.live === "recording";
    const hue = live
      ? tokens.color.semantic.destructive
      : tokens.color.semantic.warning;
    return (
      <View style={[styles.bar, { borderColor: hue }]}>
        {live ? (
          <RoundControl
            label={MEETING_RECORDER_COPY.pauseControl}
            onPress={() => void row.run("pause")}
          >
            <PauseGlyph color={ink} size={22} />
          </RoundControl>
        ) : (
          <RoundControl
            label={MEETING_RECORDER_COPY.resumeControl}
            onPress={() => void row.run("resume")}
          >
            <PlayGlyph color={ink} size={22} />
          </RoundControl>
        )}
        <View
          style={styles.barMiddle}
          accessible
          accessibilityLabel={[view.title, view.clock]
            .filter(Boolean)
            .join(", ")}
        >
          <PulseDot color={hue} pulsing={live} />
          <LevelMeter live={live} color={hue} />
          <Text style={styles.barClock}>{view.clock}</Text>
        </View>
        <RoundControl
          tone="stop"
          label={MEETING_RECORDER_COPY.stopControl}
          onPress={() => void row.run("stop")}
        >
          <StopGlyph color={tokens.color.semantic.destructive} size={22} />
        </RoundControl>
      </View>
    );
  }
  if (!primary) return null;
  return (
    <SheetPrimaryButton
      label={primary.label}
      icon={
        primary.does === "record"
          ? (color) => <MicGlyph color={color} />
          : undefined
      }
      onPress={() => void row.run(primary.does)}
      accent={accent}
      onAccent={accentOnPrimary}
    />
  );
}

/** How many readings the level shows, newest at the right. */
const LEVEL_SAMPLES = 18;
/** How often the level is read: often enough to move with a voice. */
const LEVEL_EVERY_MS = 120;

/**
 * The room's loudness over the last two seconds, as bars that rise with a
 * voice (Voice Memos' waveform), so the officer sees the phone is hearing the
 * meeting. Read from the recorder itself (`RecorderDevice.level`); flat while
 * paused. Where the recorder gives no reading (an older build), the three
 * working bars stand in, so something still moves while it records.
 */
function LevelMeter({ live, color }: { live: boolean; color: string }) {
  const read = meetingRecorderDevice()?.level ?? null;
  const [samples, setSamples] = useState<number[]>(QUIET);
  useEffect(() => {
    if (!live || !read) return;
    const timer = setInterval(() => {
      const level = read() ?? 0;
      setSamples((before) => [...before.slice(1), level]);
    }, LEVEL_EVERY_MS);
    return () => {
      clearInterval(timer);
      // Flat again for the next time it records.
      setSamples(QUIET);
    };
  }, [live, read]);

  if (live && !read) return <WorkingBars color={color} />;
  return (
    <View
      style={levelStyles.meter}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {(live ? samples : QUIET).map((level, index) => (
        <View
          key={index}
          style={[
            levelStyles.sample,
            {
              backgroundColor: color,
              height: LEVEL_FLOOR + level * (LEVEL_HEIGHT - LEVEL_FLOOR),
            },
          ]}
        />
      ))}
    </View>
  );
}

const QUIET: number[] = new Array<number>(LEVEL_SAMPLES).fill(0);

const LEVEL_HEIGHT = 24;
const LEVEL_FLOOR = 3;
const levelStyles = StyleSheet.create({
  meter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: LEVEL_HEIGHT,
    gap: 2,
  },
  sample: {
    flex: 1,
    maxWidth: 3,
    borderRadius: 1.5,
  },
});

/** The live dot: it breathes while audio is written, still while paused. */
function PulseDot({ color, pulsing }: { color: string; pulsing: boolean }) {
  const reduce = useReduceMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!pulsing || reduce) {
      cancelAnimation(scale);
      scale.set(1);
      return;
    }
    scale.set(
      withRepeat(
        withTiming(1.35, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(scale);
  }, [pulsing, reduce, scale]);
  const breathe = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));
  return (
    <Animated.View
      style={[dotStyles.dot, { backgroundColor: color }, breathe]}
    />
  );
}

const NO_RECORD = {
  status: "none",
  duration_seconds: null,
  failure_message: null,
  transcript: null,
} as const;

const DOT_SIZE = 12;
const dotStyles = StyleSheet.create({
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
});

function createStyles(tokens: SignetTokens) {
  const caption = typeRole(tokens.typography.role.caption);
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      padding: tokens.spacing.sm,
      borderRadius: 999,
      borderWidth: 1,
      backgroundColor: tokens.color.surface.card,
    },
    barMiddle: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    barClock: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      // Digits of one width, so the clock doesn't shiver as it counts.
      fontVariant: ["tabular-nums"],
    },
    line: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      color: tokens.color.semantic.destructiveText,
    },
    notice: {
      gap: tokens.spacing.sm,
    },
    // After Stop: a card, so the steps read as one thing happening.
    steps: {
      gap: tokens.spacing.md,
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      backgroundColor: tokens.color.surface.card,
    },
    step: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: 24,
    },
    stepMark: {
      width: 24,
      alignItems: "center",
    },
    doneDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    waitDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: tokens.color.border.input,
    },
    stepLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      fontVariant: ["tabular-nums"],
    },
    stepWaiting: {
      color: tokens.color.text.mutedForeground,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.lg,
    },
  });
}
