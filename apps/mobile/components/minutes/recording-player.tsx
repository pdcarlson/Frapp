import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { MEETING_RECORDER_COPY, meetingRecorderClock } from "@repo/validation";
import { PauseGlyph, PlayGlyph } from "@/components/control-glyphs";
import { RoundControl } from "@/components/minutes/recorder-controls";
import { useChapterBranding } from "@/lib/chapter-branding";
import { usePlayback } from "@/lib/minutes/playback/use-playback";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The meeting's recording, played back on its minutes while the officer
 * checks the draft (Paul, 2026-11-17: "Keep audio until minutes are
 * posted"). One round play / pause, a track of how far in, and the time, as
 * Voice Memos and Otter lay out a recording's row. Draws nothing where this
 * build can't play audio.
 */
export function RecordingPlayer({
  url,
  durationSeconds,
}: {
  url: string;
  durationSeconds: number;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const playback = usePlayback(url);
  if (!playback.available) return null;

  const whole = playback.duration ?? durationSeconds;
  const share = whole > 0 ? Math.min(1, playback.position / whole) : 0;
  const ink = tokens.color.text.foreground;
  return (
    <View style={styles.row}>
      <RoundControl
        label={
          playback.playing
            ? MEETING_RECORDER_COPY.pauseAudio
            : MEETING_RECORDER_COPY.playAudio
        }
        onPress={playback.toggle}
      >
        {playback.playing ? (
          <PauseGlyph color={ink} size={20} />
        ) : (
          <PlayGlyph color={ink} size={20} />
        )}
      </RoundControl>
      <View style={styles.body}>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: Math.round(whole),
            now: Math.round(playback.position),
          }}
        >
          <View
            style={[
              styles.fill,
              { width: `${share * 100}%`, backgroundColor: accent },
            ]}
          />
        </View>
        <Text style={styles.time}>
          {`${meetingRecorderClock(playback.position)} / ${meetingRecorderClock(whole)}`}
        </Text>
        {playback.failed ? (
          <Text style={[styles.time, styles.problem]}>
            {MEETING_RECORDER_COPY.audioGone}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    body: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    track: {
      height: 4,
      borderRadius: 2,
      overflow: "hidden",
      backgroundColor: tokens.color.border.input,
    },
    fill: {
      height: 4,
    },
    time: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    problem: {
      color: tokens.color.semantic.destructiveText,
    },
  });
}
