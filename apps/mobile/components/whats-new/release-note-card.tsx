import { StyleSheet, Text, View } from "react-native";
import {
  FRESH_RELEASE_NOTE_CAPTION,
  formatReleaseNoteDate,
  freshReleaseNoteLines,
  releaseNoteGroups,
  type ReleaseNote,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ListSection, SectionHeader } from "@/components/list-section";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";
import { useFreshReleaseLines } from "@/lib/whats-new-fresh";

/**
 * One What's new entry: a date header (written out, never "Nov 7") over one
 * card holding the entry's title and a line per change behind a small dot.
 * The lines true on both come first; the phone-only and web-only ones follow
 * under a Mobile and a Web subheading (`releaseNoteGroups`), as on the web.
 * An entry from before the split is one list.
 * The What's new screen (`app/(app)/whats-new.tsx`) lists every entry this
 * way, and the sheet that opens by itself after an update
 * (`components/whats-new/whats-new-host.tsx`) shows the new ones the same way.
 *
 * Lines that came with this phone's latest update are semibold, in the
 * foreground color, under a one-line caption saying so, when the entry also
 * holds older lines (`freshReleaseNoteLines`; Paul, 2026-11-16). `fresh`
 * overrides what `lib/whats-new-fresh.ts` worked out, for tests.
 */
export function ReleaseNoteCard({
  note,
  fresh,
}: {
  note: ReleaseNote;
  fresh?: readonly string[];
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const phoneFresh = useFreshReleaseLines();
  const marked = freshReleaseNoteLines(note, fresh ?? phoneFresh);

  return (
    <View>
      <SectionHeader>{formatReleaseNoteDate(note.date)}</SectionHeader>
      <ListSection>
        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            {note.title}
          </Text>
          {marked.size > 0 ? (
            <Text style={styles.caption}>{FRESH_RELEASE_NOTE_CAPTION}</Text>
          ) : null}
          {releaseNoteGroups(note).map((group) => (
            <View key={group.place} style={styles.group}>
              {group.label ? (
                <Text style={styles.groupLabel} accessibilityRole="header">
                  {group.label}
                </Text>
              ) : null}
              {group.lines.map((change) => (
                <View key={change} style={styles.change}>
                  <View style={styles.dot} />
                  <Text
                    style={[
                      styles.changeText,
                      marked.has(change) && styles.freshText,
                    ]}
                    accessibilityLabel={
                      marked.has(change) ? `New: ${change}` : undefined
                    }
                  >
                    {change}
                  </Text>
                </View>
              ))}
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
    // Says what the bold lines are, right under the title it belongs to.
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: -tokens.spacing.xs,
    },
    group: {
      gap: tokens.spacing.sm,
    },
    // A Web or Mobile subheading: the label role, a step above the lines.
    groupLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      marginTop: tokens.spacing.xs,
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
    // A line that came with the latest update: the body size at the
    // semibold face, in the foreground color (a face, never `fontWeight`;
    // `typeRole` says why).
    freshText: {
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
  });
}
