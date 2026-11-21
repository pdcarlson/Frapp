import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { jumpToLatestLabel } from "@repo/chat-core/jump-to-latest";

const SIZE = 40;
const DOT = 10;

/**
 * The s05 thread's way back to the newest message once the reader has scrolled
 * a screen or more into history, or once something new lands out of sight
 * below them (`useJumpToLatest` decides when). A small round `↓` over the
 * list's bottom-right corner, just above the composer, so it reserves no
 * height and the thread under it never moves.
 *
 * Elevated `--popover` with a hairline, the neutral recipe a floating control
 * takes, and the chapter's solid accent only on the dot that says a newer
 * message landed out of sight. 40pt drawn, with `hitSlop` up to
 * the 44pt floor.
 *
 * The caller renders it only while `useJumpToLatest` says to (`showsJump`).
 */
export function JumpToLatestButton({
  hasNew,
  onPress,
}: {
  hasNew: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accentPrimary } = useChapterBranding();
  const styles = createStyles(tokens);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={jumpToLatestLabel(hasNew)}
      hitSlop={(tokens.touch.minimum - SIZE) / 2}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      <Text style={styles.glyph}>↓</Text>
      {hasNew ? (
        <View
          testID="jump-to-latest-dot"
          style={[styles.dot, { backgroundColor: accentPrimary }]}
        />
      ) : null}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    button: {
      position: "absolute",
      right: tokens.spacing.lg,
      bottom: tokens.spacing.md,
      width: SIZE,
      height: SIZE,
      borderRadius: SIZE / 2,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.7,
    },
    glyph: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    // On the circle's upper-right edge, ringed in the screen background so it
    // reads as a badge on the button rather than a second control.
    dot: {
      position: "absolute",
      top: -2,
      right: -2,
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      borderWidth: 2,
      borderColor: tokens.color.surface.background,
    },
  });
}
