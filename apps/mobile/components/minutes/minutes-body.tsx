import { useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import type { MeetingActionItemTask, MeetingMinutes } from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { SignetTokens } from "@repo/theme/signet";
import {
  MEETING_COPY,
  MEETING_LIST_COPY,
  MINUTES_PREVIEW,
  MINUTES_READ_COPY,
  meetingDueLabel,
  meetingSectionLabel,
  meetingTabledFromLabel,
  meetingVoteLine,
  minutesActionMeta,
  minutesActionRows,
  minutesActionStatePrefix,
  minutesAttendanceDetail,
  minutesDateTile,
  minutesPreviewCuts,
  minutesReadSections,
  minutesTopics,
  parseMinutesNotes,
  type MeetingContent,
  type MeetingSectionKey,
  type MinutesJump,
  type MinutesNoteLine,
} from "@repo/validation";
import { CheckGlyph, DisclosureGlyph } from "@/components/control-glyphs";
import { eyebrowStyle } from "@/components/eyebrow";
import { Segmented } from "@/components/segmented";
import { useChapterBranding } from "@/lib/chapter-branding";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Minutes as a member reads them (`spec/behavior/meetings.md` § Reading
 * minutes; #5562, Paul 2026-11-19: "Scrolling through the minutes, nothing
 * stands out"). Each kind of thing has its own shape, so a scroll says what
 * it is before a word is read: the TL;DR is a card with the full summary
 * folded under it, dates are calendar tiles, decisions lead with a bold
 * headline, action items are a checklist with the reader's own first, the
 * notes are topics that open in place, and attendance is a row.
 *
 * Web's `minutes-read.tsx` draws the same blocks in the same order with the
 * same words, all from `@repo/validation`'s `minutes-read.ts`, so switching
 * between the two never feels like two systems (Paul, 2026-11-19).
 */
export function MinutesBody({
  meeting,
  content,
  nameFor,
  viewerId = null,
  tasks,
  onSectionLayout,
  renderDates,
}: {
  meeting: MeetingMinutes;
  content: MeetingContent;
  nameFor: (userId: string) => string | null;
  /** The reader, whose own action items come first. */
  viewerId?: string | null;
  /** The tasks the action items became, by their place in the list. */
  tasks?: ReadonlyMap<number, MeetingActionItemTask>;
  /** Where each section sits in the body, for the jump bar. */
  onSectionLayout?: (key: MeetingSectionKey, y: number) => void;
  /**
   * Coming up, drawn by the host: the minutes screen tracks each date
   * (`ComingUpDates`, #5672). Plain tiles without it.
   */
  renderDates?: (dates: MeetingContent["dates"]) => ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const sections = minutesReadSections(meeting.sections, content);
  const attendance =
    attendeeGroups(meeting).length > 0 ||
    meeting.sections.includes("attendees");

  if (sections.length === 0 && !attendance) {
    return <Text style={styles.quiet}>{MEETING_COPY.nothingWritten}</Text>;
  }

  return (
    <View style={styles.body}>
      {sections.length === 0 ? (
        <Text style={styles.quiet}>{MEETING_COPY.nothingWritten}</Text>
      ) : null}
      {sections.map((key) => (
        <View
          key={key}
          style={styles.section}
          onLayout={(event: LayoutChangeEvent) =>
            onSectionLayout?.(key, event.nativeEvent.layout.y)
          }
        >
          <Text
            accessibilityRole="header"
            style={[eyebrowStyle(tokens), styles.heading]}
          >
            {meetingSectionLabel(key)}
          </Text>
          <Section
            sectionKey={key}
            content={content}
            nameFor={nameFor}
            viewerId={viewerId}
            tasks={tasks ?? EMPTY_TASKS}
            renderDates={renderDates}
          />
        </View>
      ))}
      {attendance ? (
        <OpenRow
          label={MINUTES_READ_COPY.attendance}
          detail={minutesAttendanceDetail(meeting.attendees)}
        >
          <Attendees meeting={meeting} nameFor={nameFor} />
        </OpenRow>
      ) : null}
    </View>
  );
}

const EMPTY_TASKS: ReadonlyMap<number, MeetingActionItemTask> = new Map();

/**
 * The jump bar (#5562): one stop per section a member scrolls for, with how
 * many it holds, pinned over the minutes as they scroll.
 */
export function MinutesJumpBar({
  jumps,
  onJump,
}: {
  jumps: readonly MinutesJump[];
  onJump: (jump: MinutesJump) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  if (jumps.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={MINUTES_READ_COPY.jumpLabel}
      contentContainerStyle={styles.jumps}
    >
      {jumps.map((jump) => (
        <Pressable
          key={jump.key}
          accessibilityRole="button"
          accessibilityLabel={`${jump.label}, ${jump.count}`}
          onPress={() => onJump(jump)}
          hitSlop={4}
          style={({ pressed }) => [styles.jump, pressed && styles.pressed]}
        >
          <Text style={styles.jumpLabel}>{jump.label}</Text>
          <Text style={styles.jumpCount}>{jump.count}</Text>
        </Pressable>
      ))}
    </ScrollView>
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

function Attendees({
  meeting,
  nameFor,
}: {
  meeting: MeetingMinutes;
  nameFor: (userId: string) => string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const groups = attendeeGroups(meeting);
  if (groups.length === 0) {
    return (
      <Text style={styles.quiet}>
        {meeting.attendees
          ? MEETING_COPY.attendeesNone
          : MEETING_COPY.attendeesGone}
      </Text>
    );
  }
  return (
    <>
      {groups.map((group) => (
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

/** The first `preview` of a list, all of it once asked. */
function usePreview<T>(items: readonly T[], preview: number) {
  const [open, setOpen] = useState(false);
  const cut = minutesPreviewCuts(items.length, preview);
  return {
    shown: cut && !open ? items.slice(0, preview) : items,
    cut,
    open,
    toggle: () => setOpen((value) => !value),
  };
}

/** "Show all 27" under a list cut to its first few, and "Show fewer" back. */
function ShowAll({
  open,
  total,
  onToggle,
  label,
}: {
  open: boolean;
  total: number;
  onToggle: () => void;
  label?: string;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      hitSlop={8}
      style={styles.linkButton}
    >
      <Text style={[styles.link, { color: accent }]}>
        {open
          ? MINUTES_READ_COPY.showFewer
          : (label ?? MINUTES_READ_COPY.showAll(total))}
      </Text>
    </Pressable>
  );
}

/** A row that opens in place: a topic of the notes, or Attendance. */
function OpenRow({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.openRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={detail ? `${label}, ${detail}` : label}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.openHead, pressed && styles.pressed]}
      >
        <DisclosureGlyph
          color={tokens.color.text.muted}
          size={16}
          direction={open ? "down" : "right"}
        />
        <Text style={[styles.topic, styles.flex]}>{label}</Text>
        {detail ? <Text style={styles.meta}>{detail}</Text> : null}
      </Pressable>
      {open ? <View style={styles.openBody}>{children}</View> : null}
    </View>
  );
}

function Section({
  sectionKey,
  content,
  nameFor,
  viewerId,
  tasks,
  renderDates,
}: {
  sectionKey: MeetingSectionKey;
  content: MeetingContent;
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  tasks: ReadonlyMap<number, MeetingActionItemTask>;
  renderDates?: (dates: MeetingContent["dates"]) => ReactNode;
}) {
  switch (sectionKey) {
    case "tldr":
      return <TldrCard tldr={content.tldr} summary={content.summary} />;
    case "summary":
      return <Paragraph text={content.summary} />;
    case "dates":
      return renderDates ? (
        renderDates(content.dates)
      ) : (
        <MinutesDates dates={content.dates} />
      );
    case "decisions":
      return <Decisions decisions={content.decisions} />;
    case "action_items":
      return (
        <ActionChecklist
          items={content.action_items}
          nameFor={nameFor}
          viewerId={viewerId}
          tasks={tasks}
        />
      );
    case "tabled":
      return <Tabled items={content.tabled} />;
    case "discussion_log":
      return <Topics text={content.discussion_log} />;
    case "announcements":
      return (
        <Lines
          text={content.announcements}
          preview={MINUTES_PREVIEW.announcements}
        />
      );
    case "attendees":
      return null;
    default:
      return <Lines text={content[sectionKey]} />;
  }
}

function Paragraph({ text }: { text: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return <Text style={styles.text}>{text}</Text>;
}

/** The TL;DR as the page's lead, the full summary folded under it. */
function TldrCard({ tldr, summary }: { tldr: string; summary: string }) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const [open, setOpen] = useState(false);
  const hasSummary = summary.trim().length > 0;
  return (
    <View style={styles.card}>
      <NoteLines lines={parseMinutesNotes(tldr, { outline: false })} />
      {hasSummary && open ? (
        <Text style={styles.mutedText}>{summary}</Text>
      ) : null}
      {hasSummary ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          hitSlop={8}
          style={styles.linkButton}
        >
          <Text style={[styles.link, { color: accent }]}>
            {open
              ? MINUTES_READ_COPY.hideSummary
              : MINUTES_READ_COPY.readSummary}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Coming up: each day the meeting named as a calendar tile. `below` draws
 * under a date's words (what tracks it, #5672) and `trailing` at its edge
 * (its ⋯), as web's `DatesView` takes them.
 */
export function MinutesDates({
  dates,
  below,
  trailing,
}: {
  dates: MeetingContent["dates"];
  below?: (item: MeetingContent["dates"][number], index: number) => ReactNode;
  trailing?: (
    item: MeetingContent["dates"][number],
    index: number,
  ) => ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  return (
    <View style={styles.list}>
      {dates.map((item, index) => {
        const tile = minutesDateTile(item.date);
        return (
          <View key={`${item.date}-${index}`} style={styles.dateRow}>
            {/* Said by the words' label, so a reader hears it once. */}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.tile, { backgroundColor: tint(accent, 0.16) }]}
            >
              <Text style={[styles.tileMonth, { color: accent }]}>
                {tile.month}
              </Text>
              <Text style={[styles.tileDay, { color: accent }]}>
                {tile.day}
              </Text>
            </View>
            <View style={styles.flex}>
              <View
                accessible
                accessibilityLabel={`${item.text}, ${meetingDueLabel(item.date)}`}
              >
                <Text style={styles.strong}>{item.text}</Text>
                {/* The tile says the month and day; the line, the weekday. */}
                <Text style={styles.meta}>{tile.line}</Text>
              </View>
              {below?.(item, index)}
            </View>
            {trailing?.(item, index)}
          </View>
        );
      })}
    </View>
  );
}

/** Decisions lead with their headline in bold, the detail grey under it. */
function Decisions({ decisions }: { decisions: MeetingContent["decisions"] }) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const list = usePreview(decisions, MINUTES_PREVIEW.decisions);
  return (
    <View style={styles.list}>
      {list.shown.map((decision, index) => (
        <View
          key={index}
          style={[styles.decision, { borderLeftColor: accent }]}
        >
          <Text style={decision.headline ? styles.strong : styles.text}>
            {decision.headline || decision.text}
          </Text>
          {decision.headline ? (
            <Text style={styles.mutedText}>{decision.text}</Text>
          ) : null}
          {decision.vote ? (
            <Text style={styles.meta}>{meetingVoteLine(decision.vote)}</Text>
          ) : null}
        </View>
      ))}
      {list.cut ? (
        <ShowAll
          open={list.open}
          total={decisions.length}
          onToggle={list.toggle}
        />
      ) : null}
    </View>
  );
}

/**
 * The action items as a checklist, ticked as each item's task is done; the
 * reader's own first, then the ones with a due day. Mine narrows to the
 * reader's own. The boxes only show: an item is checked off by doing its
 * task.
 */
function ActionChecklist({
  items,
  nameFor,
  viewerId,
  tasks,
}: {
  items: MeetingContent["action_items"];
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  tasks: ReadonlyMap<number, MeetingActionItemTask>;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const rows = minutesActionRows(items, viewerId);
  const mineCount = rows.filter((row) => row.mine).length;
  // Null until the reader picks: Mine when some are theirs, worked out each
  // render, so a viewer who loads after the minutes still opens on Mine.
  const [picked, setFilter] = useState<"mine" | "all" | null>(null);
  const filter = picked ?? (mineCount > 0 ? "mine" : "all");
  const filtered =
    filter === "mine" && mineCount > 0 ? rows.filter((row) => row.mine) : rows;
  const list = usePreview(filtered, MINUTES_PREVIEW.action_items);
  const done = [...tasks.values()].filter((task) => task.done).length;
  return (
    <View style={styles.list}>
      {mineCount > 0 || done > 0 ? (
        <View style={styles.checklistBar}>
          {mineCount > 0 ? (
            <Segmented
              dense
              accessibilityLabel={MINUTES_READ_COPY.mine}
              value={filter}
              onChange={setFilter}
              options={[
                { value: "mine", label: MINUTES_READ_COPY.mine },
                { value: "all", label: MINUTES_READ_COPY.all(rows.length) },
              ]}
            />
          ) : (
            <View />
          )}
          {done > 0 ? (
            <Text style={styles.meta}>{MINUTES_READ_COPY.done(done)}</Text>
          ) : null}
        </View>
      ) : null}
      {list.shown.map(({ item, index, mine }) => {
        const task = tasks.get(index);
        const isDone = task?.done ?? false;
        const meta = [
          mine ? MINUTES_READ_COPY.yours : null,
          minutesActionMeta({
            owner: item.owner_user_id
              ? memberLabel(nameFor(item.owner_user_id), item.owner_user_id)
              : MINUTES_READ_COPY.nobodyNamed,
            dueLabel: item.due_date ? meetingDueLabel(item.due_date) : null,
            group: task?.group ?? null,
            done: isDone,
          }),
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <View
            key={index}
            accessible
            accessibilityLabel={`${minutesActionStatePrefix(isDone, !!task)}${item.text}. ${meta}`}
            style={styles.item}
          >
            <View
              style={[
                styles.box,
                isDone && { backgroundColor: accent, borderColor: accent },
              ]}
            >
              {isDone ? (
                <CheckGlyph color={tokens.color.surface.background} size={12} />
              ) : null}
            </View>
            <View style={styles.flex}>
              <Text style={isDone ? styles.mutedText : styles.text}>
                {item.text}
              </Text>
              <Text style={styles.meta}>{meta}</Text>
            </View>
          </View>
        );
      })}
      {list.cut ? (
        <ShowAll
          open={list.open}
          total={filtered.length}
          onToggle={list.toggle}
        />
      ) : null}
    </View>
  );
}

/** What was put off (#5522), each with where it was first tabled. */
function Tabled({ items }: { items: MeetingContent["tabled"] }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.lines}>
      {items.map((item, index) => {
        const from = meetingTabledFromLabel(item);
        return (
          <View key={index} style={styles.item}>
            <Text style={styles.bullet}>{"•"}</Text>
            <View style={styles.flex}>
              <Text style={styles.text}>{item.text}</Text>
              {from ? <Text style={styles.meta}>{from}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** The notes as topics that open in place, the first few then Show all. */
function Topics({ text }: { text: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const topics = minutesTopics(text);
  const list = usePreview(topics, MINUTES_PREVIEW.topics);
  const only = topics[0];
  if (topics.length === 1 && only && only.title === null) {
    return <NoteLines lines={only.lines} />;
  }
  return (
    <View style={styles.list}>
      {list.shown.map((topic, index) =>
        topic.title === null ? (
          <NoteLines key={index} lines={topic.lines} />
        ) : (
          <OpenRow
            key={`${topic.title}-${index}`}
            label={topic.title}
            detail={
              topic.lines.length > 0
                ? MINUTES_READ_COPY.points(topic.lines.length)
                : undefined
            }
          >
            <NoteLines lines={topic.lines} />
          </OpenRow>
        ),
      )}
      {list.cut ? (
        <ShowAll
          open={list.open}
          total={topics.length}
          onToggle={list.toggle}
          label={MINUTES_READ_COPY.allTopics(topics.length)}
        />
      ) : null}
    </View>
  );
}

/** A section read line by line; with `preview`, the first few then Show all. */
function Lines({ text, preview }: { text: string; preview?: number }) {
  const lines = parseMinutesNotes(text, { outline: false });
  const list = usePreview(lines, preview ?? lines.length);
  return (
    <>
      <NoteLines lines={list.shown} />
      {list.cut ? (
        <ShowAll open={list.open} total={lines.length} onToggle={list.toggle} />
      ) : null}
    </>
  );
}

/** Outline lines, drawn the way web's `minutes-read.tsx` draws them. */
function NoteLines({ lines }: { lines: readonly MinutesNoteLine[] }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.lines}>
      {lines.map((line, index) => {
        if (line.kind === "topic") {
          return (
            <Text
              key={index}
              accessibilityRole="header"
              style={[styles.topic, index > 0 && styles.topicGap]}
            >
              {line.text}
            </Text>
          );
        }
        if (line.kind === "point") {
          return (
            <View
              key={index}
              style={[styles.item, line.depth ? styles.subItem : null]}
            >
              <Text style={styles.bullet}>{line.depth ? "◦" : "•"}</Text>
              <View style={styles.flex}>
                <Text style={styles.text}>{line.text}</Text>
              </View>
            </View>
          );
        }
        return (
          <Text key={index} style={styles.text}>
            {line.head ? (
              <Text style={styles.topic}>{`${line.head}: `}</Text>
            ) : null}
            {line.text}
          </Text>
        );
      })}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const body = typeRole(tokens.typography.role.body);
  return StyleSheet.create({
    body: {
      gap: tokens.spacing.xl,
    },
    section: {
      gap: tokens.spacing.sm,
    },
    heading: {
      color: tokens.color.text.muted,
    },
    text: {
      ...body,
      color: tokens.color.text.foreground,
    },
    strong: {
      ...body,
      color: tokens.color.text.foreground,
      fontWeight: "600",
    },
    mutedText: {
      ...body,
      color: tokens.color.text.mutedForeground,
    },
    quiet: {
      ...body,
      color: tokens.color.text.mutedForeground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    list: {
      gap: tokens.spacing.md,
    },
    item: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    bullet: {
      ...body,
      color: tokens.color.text.muted,
    },
    flex: {
      flex: 1,
    },
    lines: {
      gap: tokens.spacing.xs,
    },
    topic: {
      ...body,
      color: tokens.color.text.foreground,
      fontWeight: "600",
    },
    topicGap: {
      marginTop: tokens.spacing.sm,
    },
    subItem: {
      paddingLeft: tokens.spacing.lg,
    },
    card: {
      gap: tokens.spacing.sm,
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      backgroundColor: tokens.color.surface.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
    },
    linkButton: {
      alignSelf: "flex-start",
      minHeight: 32,
      justifyContent: "center",
    },
    link: {
      ...typeRole(tokens.typography.role.label),
    },
    dateRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    tile: {
      width: 48,
      paddingVertical: tokens.spacing.xs,
      alignItems: "center",
      borderRadius: tokens.radius.control,
    },
    tileMonth: {
      ...typeRole(tokens.typography.role.caption),
      fontWeight: "600",
      letterSpacing: 0.8,
    },
    tileDay: {
      ...typeRole(tokens.typography.role.title),
      fontWeight: "700",
    },
    decision: {
      gap: 2,
      borderLeftWidth: 2,
      paddingLeft: tokens.spacing.md,
    },
    checklistBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    box: {
      width: 18,
      height: 18,
      marginTop: 3,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: tokens.color.border.control,
    },
    openRow: {
      borderRadius: tokens.radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
    },
    openHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: 44,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
    },
    openBody: {
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.md,
      paddingBottom: tokens.spacing.md,
    },
    pressed: {
      opacity: 0.6,
    },
    jumps: {
      gap: tokens.spacing.xs,
      paddingVertical: tokens.spacing.sm,
    },
    jump: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      minHeight: 32,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chip,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
    },
    jumpLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
    },
    jumpCount: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
