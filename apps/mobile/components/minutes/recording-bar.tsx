import { Pressable, StyleSheet, Text, View } from "react-native";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOpenChatTransport } from "@repo/hooks/open-chat-transport";
import { SignetTokens } from "@repo/theme/signet";
import { MEETING_RECORDER_COPY, connectionIndicator } from "@repo/validation";
import { useConnection } from "@/lib/connection/use-connection";
import { recordingBarView } from "@/lib/minutes/recorder/row-view";
import { recorderMeetingId } from "@/lib/minutes/recorder/machine";
import { useMeetingRecorder } from "@/lib/minutes/recorder/session";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The recording indicator on every screen but the one that owns it
 * (`spec/behavior/meetings.md` § Recording notice: "the recording phone
 * shows a visible indicator for as long as it records").
 *
 * While the phone records a meeting, has paused, is uploading, or is
 * holding a recording that hasn't been uploaded, a pill floats at the top of
 * the window: a red dot and "Recording 1:02:33". A tap opens that meeting's
 * minutes, where the controls are. On the minutes screen itself the row
 * says all of this, so the pill steps aside. It is the in-app twin of what
 * the system already shows (iOS's orange microphone dot, Android's
 * recording notification), the way a call in progress keeps a pill at the
 * top of every app.
 *
 * It floats like the connection pill (`network-banner.tsx`) and takes no
 * layout, so nothing moves when it comes or goes; when both have something
 * to say it sits under that one.
 */
const PILL_HEIGHT = 32;
const DOT_SIZE = 8;

export function RecordingBar() {
  const { tokens } = useFrappTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(tokens);
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ id?: string | string[] }>();
  const { state } = useMeetingRecorder();
  const connection = connectionIndicator(
    useConnection().state,
    useOpenChatTransport(),
  );

  const view = recordingBarView(state);
  const meetingId = recorderMeetingId(state);
  if (!view || !meetingId) return null;
  const openId = Array.isArray(params.id) ? params.id[0] : params.id;
  if (pathname === "/minutes-details" && openId === meetingId) return null;

  const dot =
    view.dot === "live"
      ? tokens.color.semantic.destructive
      : tokens.color.semantic.warning;
  const top =
    insets.top +
    tokens.spacing.xs +
    (connection ? PILL_HEIGHT + tokens.spacing.xs : 0);

  return (
    <View style={[styles.overlay, { top }]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={view.description}
        accessibilityHint={MEETING_RECORDER_COPY.barHint}
        onPress={() =>
          router.push({ pathname: "/minutes-details", params: { id: meetingId } })
        }
        style={({ pressed }) => [styles.pill, pressed ? styles.pressed : null]}
      >
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Text style={styles.text} numberOfLines={1}>
          {view.label}
        </Text>
      </Pressable>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    overlay: {
      position: "absolute",
      left: 0,
      right: 0,
      alignItems: "center",
      paddingHorizontal: tokens.spacing.lg,
      // Over every screen, as the connection pill is.
      zIndex: 1000,
      elevation: 1000,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      maxWidth: "100%",
      minHeight: PILL_HEIGHT,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: PILL_HEIGHT / 2,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.popover,
    },
    pressed: {
      opacity: 0.7,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
    },
    text: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
      fontVariant: ["tabular-nums"],
    },
  });
}
