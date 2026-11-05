import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One large answer on a pre-chapter screen: s02's "I have an invite" and
 * "I'm starting our chapter" (#3350), and each chapter on the chapter picker,
 * which reuses s02's visual language.
 *
 * A lighter surface with a hairline, never a shadow (foundations.md §10). The
 * trailing slot is a chevron unless the caller passes something else, such as
 * the picker's spinner on the row being opened.
 */
export function ChoiceRow({
  title,
  body,
  onPress,
  disabled = false,
  dimmed = false,
  busy = false,
  trailing,
  accessibilityHint,
}: {
  title: string;
  body?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Drawn at half strength: disabled, or a sibling of the row in flight. */
  dimmed?: boolean;
  busy?: boolean;
  trailing?: ReactNode;
  accessibilityHint?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed ? styles.pressed : null,
        dimmed ? styles.dimmed : null,
      ]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
      </View>
      {trailing ?? <Text style={styles.chevron}>›</Text>}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
    },
    pressed: {
      backgroundColor: tokens.color.surface.surface1,
    },
    // A row that can't respond dims as a whole, so it looks it.
    dimmed: {
      opacity: 0.5,
    },
    copy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    chevron: {
      fontSize: 26,
      lineHeight: 28,
      color: tokens.color.text.muted,
    },
  });
}
