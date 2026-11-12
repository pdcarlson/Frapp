import { StyleSheet, Text, View } from "react-native";
import type { MeetingMinutes } from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { SignetTokens } from "@repo/theme/signet";
import {
  MEETING_COPY,
  MEETING_LIST_COPY,
  meetingDueLabel,
  meetingSectionLabel,
  meetingVoteLine,
  shownMeetingSections,
  type MeetingContent,
  type MeetingSectionKey,
} from "@repo/validation";
import { eyebrowStyle } from "@/components/eyebrow";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Minutes as a member reads them (`spec/behavior/meetings.md` § Reading
 * minutes): each section the chapter's template keeps, in the template's
 * order, plus any section that has words in it. Web's read view is in
 * `minutes-page.tsx`; both pick sections with `shownMeetingSections` and say
 * a vote and a due day the same way.
 *
 * A document to read, so it is set as one: an eyebrow over each section and
 * body text under it, no cards. A section with nothing written is left out,
 * never drawn as an empty heading.
 */
export function MinutesBody({
  meeting,
  content,
  nameFor,
}: {
  meeting: MeetingMinutes;
  content: MeetingContent;
  nameFor: (userId: string) => string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const sections = shownMeetingSections(meeting.sections, content).filter(
    (key) => hasSomething(key, meeting, content),
  );

  if (sections.length === 0) {
    return <Text style={styles.quiet}>{MEETING_COPY.nothingWritten}</Text>;
  }

  return (
    <>
      {sections.map((key) => (
        <View key={key} style={styles.section}>
          <Text
            accessibilityRole="header"
            style={[eyebrowStyle(tokens), styles.heading]}
          >
            {meetingSectionLabel(key)}
          </Text>
          <Section
            sectionKey={key}
            meeting={meeting}
            content={content}
            nameFor={nameFor}
            styles={styles}
          />
        </View>
      ))}
    </>
  );
}

function attendeeGroups(meeting: MeetingMinutes) {
  const attendees = meeting.attendees;
  if (!attendees) return [];
  return [
    { label: MEETING_LIST_COPY.present, ids: attendees.present },
    { label: MEETING_LIST_COPY.late, ids: attendees.late },
    { label: MEETING_LIST_COPY.excused, ids: attendees.excused },
  ].filter((group) => group.ids.length > 0);
}

function hasSomething(
  key: MeetingSectionKey,
  meeting: MeetingMinutes,
  content: MeetingContent,
): boolean {
  if (key === "attendees") return attendeeGroups(meeting).length > 0;
  if (key === "decisions") return content.decisions.length > 0;
  if (key === "action_items") return content.action_items.length > 0;
  return content[key].trim().length > 0;
}

type Styles = ReturnType<typeof createStyles>;

function Section({
  sectionKey,
  meeting,
  content,
  nameFor,
  styles,
}: {
  sectionKey: MeetingSectionKey;
  meeting: MeetingMinutes;
  content: MeetingContent;
  nameFor: (userId: string) => string | null;
  styles: Styles;
}) {
  if (sectionKey === "attendees") {
    return (
      <>
        {attendeeGroups(meeting).map((group) => (
          <View key={group.label}>
            <Text style={styles.meta}>
              {group.label}, {group.ids.length}
            </Text>
            <Text style={styles.text}>
              {group.ids
                .map((userId) => memberLabel(nameFor(userId), userId))
                .sort((a, b) => a.localeCompare(b))
                .join(", ")}
            </Text>
          </View>
        ))}
      </>
    );
  }
  if (sectionKey === "decisions") {
    return (
      <>
        {content.decisions.map((decision, index) => (
          <View key={index} style={styles.item}>
            <Text style={styles.bullet}>{"•"}</Text>
            <View style={styles.itemText}>
              <Text style={styles.text}>{decision.text}</Text>
              {decision.vote ? (
                <Text style={styles.meta}>{meetingVoteLine(decision.vote)}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </>
    );
  }
  if (sectionKey === "action_items") {
    return (
      <>
        {content.action_items.map((item, index) => {
          const meta = [
            item.owner_user_id
              ? memberLabel(nameFor(item.owner_user_id), item.owner_user_id)
              : null,
            item.due_date ? `Due ${meetingDueLabel(item.due_date)}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <View key={index} style={styles.item}>
              <Text style={styles.bullet}>{"•"}</Text>
              <View style={styles.itemText}>
                <Text style={styles.text}>{item.text}</Text>
                {meta ? <Text style={styles.meta}>{meta}</Text> : null}
              </View>
            </View>
          );
        })}
      </>
    );
  }
  return <Text style={styles.text}>{content[sectionKey]}</Text>;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    section: {
      gap: tokens.spacing.sm,
    },
    heading: {
      color: tokens.color.text.muted,
    },
    text: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    quiet: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    item: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    bullet: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.muted,
    },
    itemText: {
      flex: 1,
    },
  });
}
