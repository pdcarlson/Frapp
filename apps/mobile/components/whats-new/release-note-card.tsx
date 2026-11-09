import { StyleSheet, Text, View } from "react-native";
import { formatReleaseNoteDate, type ReleaseNote } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ListSection, SectionHeader } from "@/components/list-section";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One What's new entry: a date header (written out, never "Nov 7") over one
 * card holding the entry's title and a line per change behind a small dot.
 * The What's new screen (`app/(app)/whats-new.tsx`) lists every entry this
 * way, and the sheet that opens by itself after an update
 * (`components/whats-new/whats-new-host.tsx`) shows the new ones the same way.
 */
export function ReleaseNoteCard({ note }: { note: ReleaseNote }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View>
      <SectionHeader>{formatReleaseNoteDate(note.date)}</SectionHeader>
      <ListSection>
        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            {note.title}
          </Text>
          {note.changes.map((change) => (
            <View key={change} style={styles.change}>
              <View style={styles.dot} />
              <Text style={styles.changeText}>{change}</Text>
            </View>
          ))}
        </View>
      </ListSection>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const body = typeRole(tokens.typography.role.body);
  return StyleSheet.create({
    card: {
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    change: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.sm,
    },
    // Centred on the first line of its text: half the line box, less half
    // the dot.
    dot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      marginTop: ((body.lineHeight ?? 22) - 4) / 2,
      backgroundColor: tokens.color.text.muted,
    },
    changeText: {
      ...body,
      flex: 1,
      color: tokens.color.text.mutedForeground,
    },
  });
}
