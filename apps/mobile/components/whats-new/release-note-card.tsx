import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  formatReleaseNoteDate,
  openingReleaseNotePlace,
  releaseNoteGroups,
  type ReleaseNote,
  type ReleaseNotePlace,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ListSection, SectionHeader } from "@/components/list-section";
import { Segmented } from "@/components/segmented";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One What's new entry: a date header (written out, never "Nov 7") over one
 * card holding the entry's title and a line per change behind a small dot.
 * An entry whose lines are split by place (`releaseNoteGroups`) puts a
 * switch under its title, Both, Web and Phone with each one's count, so the
 * breakdown reads before any line does and one place's lines show at a time.
 * It opens on Phone, the surface the reader is on, as the web's opens on Web
 * (`openingReleaseNotePlace`). An older entry is one list with no switch.
 * The What's new screen (`app/(app)/whats-new.tsx`) lists every entry this
 * way, and the sheet that opens by itself after an update
 * (`components/whats-new/whats-new-host.tsx`) shows the new ones the same way.
 */
export function ReleaseNoteCard({ note }: { note: ReleaseNote }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const groups = releaseNoteGroups(note);
  const [place, setPlace] = useState<ReleaseNotePlace | null>(() =>
    openingReleaseNotePlace(groups, "phone"),
  );
  const split = Boolean(groups[0]?.label);
  const shown = split
    ? groups.filter((group) => group.place === place)
    : groups;

  return (
    <View>
      <SectionHeader>{formatReleaseNoteDate(note.date)}</SectionHeader>
      <ListSection>
        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            {note.title}
          </Text>
          {split && groups.length > 1 && place ? (
            <Segmented
              accessibilityLabel={`Where these changes are, ${formatReleaseNoteDate(note.date)}`}
              value={place}
              onChange={setPlace}
              options={groups.map((group) => ({
                value: group.place,
                label: `${group.short} ${group.lines.length}`,
              }))}
            />
          ) : null}
          {shown.map((group) => (
            <View key={group.place} style={styles.group}>
              {/* A split entry with one place names it, since no switch does. */}
              {split && groups.length === 1 ? (
                <Text style={styles.groupLabel}>{group.label}</Text>
              ) : null}
              {group.lines.map((change) => (
                <View key={change} style={styles.change}>
                  <View style={styles.dot} />
                  <Text style={styles.changeText}>{change}</Text>
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
    group: {
      gap: tokens.spacing.sm,
    },
    // The one place of a split entry with no switch: a quiet caption.
    groupLabel: {
      ...typeRole(tokens.typography.role.caption),
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
