import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SignetTokens } from "@repo/theme/signet";
import {
  IMPORTANT_STRIP_DISMISS_LABEL,
  importantStripActionLabel,
  importantStripLabel,
} from "@repo/hooks";
import { AlertGlyph, CloseGlyph } from "@/components/control-glyphs";
import { fontFamilyFor, tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The "1 important message" strip (#4186, slice 4 of #3921), under the s05
 * header and above the thread.
 *
 * The Important row's paint (components.md § A flagged row): the danger tint,
 * a 2pt danger bar on the leading edge, and the alert glyph and count in
 * `destructiveText`. The phone has room for the count alone, then "Show ↑",
 * then ×. 44pt tall, the touch floor, so the whole strip is one target that
 * jumps to the oldest unseen message, and × is its own 44pt target that
 * marks every one seen.
 *
 * The caller renders it only while `total > 0`.
 */
export function ImportantStrip({
  total,
  onShow,
  onDismiss,
}: {
  total: number;
  onShow: () => void;
  onDismiss: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const danger = tokens.color.semantic.destructive;
  return (
    <View
      testID="important-strip"
      style={[
        styles.strip,
        { backgroundColor: tint(danger), borderLeftColor: danger },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={importantStripActionLabel(total)}
        onPress={onShow}
        style={({ pressed }) => [styles.show, pressed ? styles.pressed : null]}
      >
        <AlertGlyph size={14} color={tokens.color.semantic.destructiveText} />
        <Text numberOfLines={1} style={styles.count}>
          {importantStripLabel(total)}
        </Text>
        <Text style={styles.action}>Show ↑</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={IMPORTANT_STRIP_DISMISS_LABEL}
        onPress={onDismiss}
        style={({ pressed }) => [
          styles.dismiss,
          pressed ? styles.pressed : null,
        ]}
      >
        <CloseGlyph size={16} color={tokens.color.text.mutedForeground} />
      </Pressable>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    strip: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: tokens.touch.minimum,
      borderLeftWidth: 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    show: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      paddingLeft: tokens.spacing.md,
      paddingRight: tokens.spacing.sm,
    },
    count: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.semantic.destructiveText,
      flexShrink: 1,
    },
    action: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
      marginLeft: "auto",
    },
    dismiss: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: { opacity: 0.7 },
  });
}
