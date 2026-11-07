import { StyleSheet, Text, View } from "react-native";
import { RELEASE_NOTES, formatReleaseNoteDate } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_SETTINGS } from "@/components/back-row";
import { ListSection, SectionHeader } from "@/components/list-section";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * What's new: the app's changes in members' words, newest first, opened from
 * Settings. The list is `RELEASE_NOTES` in `@repo/validation`, the same one
 * web's account menu opens and `npm run release-notes` prints for testers, so
 * the three never say different things.
 *
 * Each entry is a date header (written out, never "Nov 7") over one card:
 * the entry's title, then a line per change behind a small dot. It ships in
 * the bundle, so it reads offline and an over-the-air update brings the new
 * entry with the code it describes.
 */
export default function WhatsNewScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <ScreenShell back={BACK_TO_SETTINGS} title="What's new">
      {RELEASE_NOTES.map((note) => (
        <View key={note.date}>
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
      ))}
    </ScreenShell>
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
