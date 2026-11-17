import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { CheckGlyph } from "@/components/control-glyphs";
import { ListRow, ListSection } from "@/components/list-section";
import {
  MEETING_START_COPY,
  type MeetingChoice,
  type MeetingOption,
} from "@/lib/minutes/start-minutes";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** Two choices are the same meeting: the same event, or both new. */
export function sameChoice(a: MeetingChoice, b: MeetingChoice): boolean {
  if (a.kind === "new" || b.kind === "new") return a.kind === b.kind;
  return a.event.id === b.event.id;
}

/**
 * The meeting minutes start on, as one row with Change (#5287). Record
 * meeting's notice and New minutes both carry it, so the meeting is never a
 * step of its own: the + has already picked the one on now, or a new one.
 * Change lists the recent meetings and "Chapter meeting, not on the
 * calendar" in place, the way web's New minutes does (#5219), and a pick
 * folds the list away again. With nothing picked (the meeting on now has
 * someone else's minutes) the list is open from the start, under a line
 * saying why.
 */
export function MeetingPickField({
  value,
  label,
  options,
  note = null,
  onChange,
}: {
  /** The meeting picked, or null when the officer has to pick one. */
  value: MeetingChoice | null;
  /** The chosen meeting's own two lines. */
  label: { title: string; detail: string } | null;
  options: readonly MeetingOption[];
  /** A line above the list: why nothing is picked yet. */
  note?: string | null;
  onChange: (choice: MeetingChoice) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [open, setOpen] = useState(false);

  if (!open && value && label) {
    return (
      <ListSection>
        <ListRow
          label={label.title}
          description={label.detail}
          value={MEETING_START_COPY.change}
          accessibilityHint="Lists the recent meetings to pick another."
          onPress={() => setOpen(true)}
        />
      </ListSection>
    );
  }
  return (
    <View style={styles.list}>
      <Text accessibilityRole="header" style={styles.heading}>
        {MEETING_START_COPY.pickHeading}
      </Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      <ListSection>
        {options.map((option) => {
          const picked = value !== null && sameChoice(option.choice, value);
          return (
            <ListRow
              key={
                option.choice.kind === "event" ? option.choice.event.id : "new"
              }
              label={option.title}
              description={option.detail}
              trailing={
                picked ? (
                  <CheckGlyph color={tokens.color.text.foreground} />
                ) : undefined
              }
              accessibilityValue={picked ? "Picked" : undefined}
              onPress={() => {
                onChange(option.choice);
                setOpen(false);
              }}
            />
          );
        })}
      </ListSection>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    list: { gap: tokens.spacing.sm },
    heading: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
