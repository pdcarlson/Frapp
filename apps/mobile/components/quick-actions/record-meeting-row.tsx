import { Pressable, StyleSheet, Text, View } from "react-native";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { SignetTokens } from "@repo/theme/signet";
import { NavGlyph } from "@/components/nav-glyph";
import type { RecordMeetingEntry } from "@/components/quick-actions/meeting-actions";
import { MEETING_START_COPY } from "@/lib/minutes/start-minutes";
import { fontFamilyFor, tint, typeRole, useFrappTheme } from "@/lib/theme";

const DOT = 36;

/**
 * Record meeting, the full-width row at the top of the + panel (#5287;
 * Paul's pick 2026-11-17: a row above the grid, not one of its actions).
 * It is what the + is most for on meeting night, the way Granola's + and
 * Voice Memos' red button are, so no edit can remove or move it and it
 * takes none of the nine slots. Red is the recorder's own: the minutes
 * screen's row and the pill over every screen draw a recording in it.
 *
 * The second line says which meeting it will record ("Chapter meeting is on
 * now", "Starts a new meeting, today"), or, while the phone holds a
 * recording, what the recorder is doing ("Recording 12:04"), and a tap then
 * opens it.
 */
export function RecordMeetingRow({
  entry,
  onPress,
}: {
  entry: RecordMeetingEntry;
  /** Closes the panel, then runs the entry. */
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entry.held ? entry.detail : MEETING_START_COPY.record}
      accessibilityHint={
        entry.held
          ? "Opens the minutes being recorded."
          : `${entry.detail}. Opens the recording notice.`
      }
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.dot}>
        <NavGlyph
          paths={NAV_GLYPHS.record}
          color={tokens.color.semantic.onSemantic}
          size={20}
        />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {entry.held ? entry.detail : MEETING_START_COPY.record}
        </Text>
        {entry.held ? null : (
          <Text style={styles.detail} numberOfLines={1}>
            {entry.detail}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  const red = tokens.color.semantic.destructive;
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: 58,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      marginHorizontal: tokens.spacing.xs,
      marginBottom: tokens.spacing.lg,
      borderRadius: 20,
      backgroundColor: tint(red, 0.13),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tint(red, 0.3),
    },
    pressed: { backgroundColor: tint(red, 0.22) },
    dot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: red,
    },
    text: { flex: 1, minWidth: 0 },
    title: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    detail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
