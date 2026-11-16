import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  dayDelta,
  formatClockShort,
  formatDayHeading,
  parseInstant,
  parseInstantOrBareLocalNoon,
  isDueOverdue,
} from "@repo/formatting";
import { useNowDate } from "@repo/hooks";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { eyebrowStyle } from "@/components/eyebrow";
import { ForwardGlyph } from "@/components/control-glyphs";
import { LEAD_TILE_GLYPH, LeadTile } from "@/components/lead-tile";
import {
  ListSection,
  listRowHint,
  PressableRow,
} from "@/components/list-section";
import { NavGlyph } from "@/components/nav-glyph";

/**
 * The UP NEXT strip at the top of Chat home (s04).
 *
 * `spec/ui/mobile/navigation.md` § Global entries outside the tab bar — "the
 * next event and the nearest due task as compact rows, each tapping through
 * to its detail… It is a pulse affordance: chat is home, so the one glanceable
 * 'what's next' surface rides above the channel list rather than living in a
 * Home tab."
 *
 * One card holding two rows (#4610, step 3), each the Activity row's frame:
 * the kind's glyph in a lead tile, the title on its own line, when and where
 * on the line under it, and the chevron of a row that opens something. Until
 * then the board's drawing held (`canvas-screens.dc.html:117-131`): two bare
 * rows on the screen background, a 20pt glyph, the title and its context on
 * one line and the time trailing. On a phone that line cut most titles mid
 * word ("Circulate the chapter meeting agen"), and nothing about the rows said
 * they could be pressed. Google Calendar's schedule and Slack's Later list
 * give a title its own line for the same reason.
 *
 * The glyphs are the shared nav set's Events and Tasks shapes, neutral: the
 * shape says at a glance whether a row is an event or a task. The event's
 * time is the foreground text and its place is muted; an overdue task's due
 * line is `semantic.destructive`, which is the drawn danger red, **not** the
 * mention red `#E5484D`, which `foundations.md:67` reserves for direct
 * address alone.
 *
 * The two rows render independently: a chapter with events but no open tasks
 * still gets its event row. With neither, the strip renders nothing at all
 * rather than an empty-state card — it is chrome above the real content, and an
 * "everything is clear" card would push the channel list down to say nothing.
 *
 * Nothing here takes the chapter accent: row icons, labels and times are
 * neutral (foundations.md §6, "Where the accent goes", 2026-11-05).
 */

/**
 * Minimal shapes. `GET /v1/tasks` has no response schema; `GET /v1/events`
 * has had one since #4867, and moving this onto it is #4952.
 */
interface UpNextEvent {
  id: string;
  name: string;
  location: string | null;
  start_time: string;
}

interface UpNextTask {
  id: string;
  title: string;
  due_date: string;
  status: string;
}

export interface UpNextStripProps {
  events: unknown;
  tasks: unknown;
  viewerUserId: string | null;
  /** Injected so the relative labels are deterministic under test. */
  now?: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function str(row: Record<string, unknown>, key: string): string | null {
  const raw = row[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** Soonest event whose start is still ahead of `now`. */
export function selectNextEvent(
  events: unknown,
  now: Date,
): UpNextEvent | null {
  const upcoming = asArray(events)
    .map((row) => {
      const id = str(row, "id");
      const name = str(row, "name");
      const startTime = str(row, "start_time");
      if (!id || !name || !startTime) return null;
      const start = parseInstant(startTime);
      if (!start) return null;
      const at = start.getTime();
      if (at < now.getTime()) return null;
      return {
        at,
        event: {
          id,
          name,
          location: str(row, "location"),
          start_time: startTime,
        },
      };
    })
    .filter((entry): entry is { at: number; event: UpNextEvent } => !!entry);

  upcoming.sort((a, b) => a.at - b.at);
  return upcoming[0]?.event ?? null;
}

/**
 * Nearest task still owed. `COMPLETED` is excluded; `OVERDUE` deliberately is
 * not — an overdue task is the most urgent thing the strip can say.
 *
 * Sort keys go through {@link parseInstantOrBareLocalNoon}, the same parse as
 * {@link formatDueDate} / {@link isDueUrgent}. `new Date("YYYY-MM-DD")` is UTC
 * midnight; mixing that with the noon parse would pick a different "nearest"
 * task if a chat card ever handed a full timestamp beside a bare due date.
 */
/**
 * `viewerUserId` is required, not optional, because `GET /v1/tasks` widens for
 * an admin — `TaskService.list` reads the whole chapter for `tasks:manage` and
 * pins everyone else to `assigneeId: userId` — and this strip is drawn as the viewer's
 * one glanceable "what's next". Unfiltered, a `tasks:manage` officer saw
 * whichever member's task fell due soonest, in destructive red, occupying the
 * single slot their own task should hold; tapping it landed on a board that is
 * assignee-filtered, so the task was not there. `lib/tasks/board.ts` already
 * applies this rule (`assignee_id !== viewerUserId` → skip) and `useTasks`'s own
 * docblock states it: "A surface drawn as a personal board therefore has to
 * filter by assignee itself." A `null` id yields no task rather than an
 * unfiltered one.
 */
export function selectNextTask(
  tasks: unknown,
  viewerUserId: string | null,
): UpNextTask | null {
  if (!viewerUserId) return null;
  const open = asArray(tasks)
    .filter((row) => str(row, "assignee_id") === viewerUserId)
    .map((row) => {
      const id = str(row, "id");
      const title = str(row, "title");
      const dueDate = str(row, "due_at") ?? str(row, "due_date");
      const status = str(row, "status") ?? "TODO";
      if (!id || !title || !dueDate) return null;
      if (status === "COMPLETED") return null;
      const parsed = parseInstantOrBareLocalNoon(dueDate);
      if (!parsed) return null;
      const at = parsed.getTime();
      return { at, task: { id, title, due_date: dueDate, status } };
    })
    .filter((entry): entry is { at: number; task: UpNextTask } => !!entry);

  open.sort((a, b) => a.at - b.at);
  return open[0]?.task ?? null;
}

/**
 * The day in words, never abbreviated (owner, 2026-11-07): "Today",
 * "Tomorrow", a weekday inside the coming week ("Sunday"), else the full date
 * ("November 14", or "January 5, 2027" outside this year). `@repo/formatting`'s
 * `formatDayHeading`, which the Events
 * tab heads its days with, so the strip and the list say a day the same way.
 * Exported for the strip's due line too.
 */
export function formatDayWord(at: Date, now: Date): string {
  return formatDayHeading(at.toISOString(), now) ?? "";
}

/** The day in words, then the clock time while it is inside the coming week. */
export function formatEventTime(startTime: string, now: Date): string {
  const start = parseInstant(startTime);
  if (!start) return "";
  const day = formatDayWord(start, now);
  const days = dayDelta(now, start);
  if (days < 0 || days >= 7) return day;
  const clock = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} ${clock}`;
}

/**
 * A task due date as an instant.
 *
 * `tasks.due_date` is a bare `YYYY-MM-DD`, which `new Date()` reads as UTC
 * **midnight** — the previous local day for everyone west of Greenwich. Fed to
 * the local-calendar `dayDelta`, that made every due date land one day
 * early: a task due Saturday painted `destructive` on Thursday for every US
 * user. Local noon is the fix `lib/more/service-hours.ts` already documents.
 *
 * A full timestamp is passed through untouched, because the chat `kind:"task"`
 * card can carry one and forcing `T12:00:00` onto it would produce `NaN`.
 */
function parseDueInstant(value: string): Date | null {
  // Bare YYYY-MM-DD at local noon (protected cluster) so no timezone shifts
  // the due date a day. Full timestamps pass through — appending T12:00:00
  // to one yields NaN.
  return parseInstantOrBareLocalNoon(value);
}

export function formatDueDate(dueDate: string, now: Date): string {
  const due = parseDueInstant(dueDate);
  if (!due) return "";
  const days = dayDelta(now, due);
  // A task due at a time (a full timestamp, #4003) is overdue from that
  // minute, and today it says when.
  const timed = dueDate.length > 10;
  if (days < 0 || (timed && due.getTime() <= now.getTime())) return "Overdue";
  if (days === 0)
    return timed ? `Due at ${formatClockShort(due)}` : "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due ${formatDayWord(due, now)}`;
}

/**
 * Past due — the one state drawn in red. Due today or tomorrow stays plain,
 * as on web (Shawn's pick, #4133, 2026-11-12; until then today and tomorrow
 * were red too). The rule is `@repo/formatting`'s `isDueOverdue`.
 */
export function isDueUrgent(dueDate: string, now: Date): boolean {
  return isDueOverdue(dueDate, now);
}

export function UpNextStrip({
  events,
  tasks,
  viewerUserId,
  now,
}: UpNextStripProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();

  // One clock for both rows, so they cannot straddle a tick and disagree about
  // what "today" means. It is the shared ticking clock, not a time read once:
  // chat home is a tab that never unmounts, and a memoised `new Date()` froze
  // the strip at the moment it first mounted, so an event that had started
  // stayed UP NEXT and "Today" kept meaning that day until the app was killed.
  const clock = useNowDate();
  const at = now ?? clock;
  const event = useMemo(() => selectNextEvent(events, at), [events, at]);
  const task = useMemo(
    () => selectNextTask(tasks, viewerUserId),
    [tasks, viewerUserId],
  );

  if (!event && !task) return null;

  const eventTime = event ? formatEventTime(event.start_time, at) : "";
  const taskDue = task ? formatDueDate(task.due_date, at) : "";

  return (
    <View style={styles.strip}>
      <Text style={styles.eyebrow}>UP NEXT</Text>

      <ListSection>
        {event ? (
          <PressableRow
            onCard
            accessibilityRole="button"
            accessibilityLabel={`${event.name}, ${eventTime}`}
            accessibilityHint={listRowHint(
              event.location,
              "Open event details.",
            )}
            // Carries the id since C2 (#994). C1 pushed the bare literal
            // because s07 was a hardcoded screen that could not consume one.
            // The `pathname:` object form is covered by `lib/routes.spec.ts`.
            onPress={() =>
              router.push({
                pathname: "/event-details",
                params: { id: event.id },
              })
            }
            style={styles.row}
          >
            <LeadTile size="lead" on="card" testID="up-next-event-tile">
              <NavGlyph
                paths={NAV_GLYPHS.events}
                color={tokens.color.text.mutedForeground}
                size={LEAD_TILE_GLYPH}
              />
            </LeadTile>
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {event.name}
              </Text>
              <Text numberOfLines={1} style={styles.rowMeta}>
                <Text style={styles.eventTime}>{eventTime}</Text>
                {event.location ? ` · ${event.location}` : null}
              </Text>
            </View>
            <ForwardGlyph color={tokens.color.text.mutedForeground} />
          </PressableRow>
        ) : null}

        {task ? (
          <PressableRow
            onCard
            accessibilityRole="button"
            accessibilityLabel={`${task.title}, ${taskDue}`}
            accessibilityHint="Open the task board."
            onPress={() => router.navigate("/tasks")}
            style={styles.row}
          >
            <LeadTile size="lead" on="card" testID="up-next-task-tile">
              <NavGlyph
                paths={NAV_GLYPHS.tasks}
                color={tokens.color.text.mutedForeground}
                size={LEAD_TILE_GLYPH}
              />
            </LeadTile>
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {task.title}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.rowMeta,
                  task.status === "OVERDUE" || isDueUrgent(task.due_date, at)
                    ? styles.dueUrgent
                    : null,
                ]}
              >
                {taskDue}
              </Text>
            </View>
            <ForwardGlyph color={tokens.color.text.mutedForeground} />
          </PressableRow>
        ) : null}
      </ListSection>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    strip: {
      gap: tokens.spacing.sm,
    },
    // The shared eyebrow, as Chat home's section headings draw it.
    eyebrow: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.mutedForeground,
    },
    // The Activity row's frame inside a card: lead tile, two lines, chevron.
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
    },
    rowText: {
      flex: 1,
      minWidth: 0,
      gap: tokens.spacing.xs,
    },
    rowTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    rowMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    // When is the fact the strip exists for, so it reads a step above where.
    eventTime: {
      color: tokens.color.text.foreground,
    },
    dueUrgent: {
      color: tokens.color.semantic.destructive,
    },
  });
}
