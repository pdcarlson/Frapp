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

/** Two choices are the same meeting: the same event, or both No meeting. */
function sameChoice(a: MeetingChoice, b: MeetingChoice): boolean {
  if (a.kind === "none" || b.kind === "none") return a.kind === b.kind;
  return a.event.id === b.event.id;
}

/**
 * The meeting minutes start on, as one row with Change (#5287). Record
 * meeting's notice and New minutes both carry it, so the meeting is never a
 * step of its own: the + has already picked the one on now, or No meeting.
 * Change lists the recent meetings and No meeting in place, the way web's
 * New minutes does, and a pick folds the list away again. A meeting someone
 * else already has minutes for shows as Has minutes and can't be picked
 * (Paul, 2026-11-20: indicate, don't narrate).
 */
export function MeetingPickField({
  value,
  label,
  options,
  onChange,
}: {
  /** The meeting picked, or null when the officer has to pick one. */
  value: MeetingChoice | null;
  /** The chosen meeting's own two lines. */
  label: { title: string; detail: string } | null;
  options: readonly MeetingOption[];
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
      <ListSection>
        {options.map((option) => {
          const picked = value !== null && sameChoice(option.choice, value);
          return (
            <ListRow
              key={
                option.choice.kind === "event" ? option.choice.event.id : "none"
              }
              label={option.title}
              description={option.detail}
              trailing={
                picked ? (
                  <CheckGlyph color={tokens.color.text.foreground} />
                ) : undefined
              }
              accessibilityValue={picked ? "Picked" : undefined}
              disabled={option.disabled}
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
  });
}
