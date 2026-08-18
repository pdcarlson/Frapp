import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The UP NEXT strip at the top of Chat home (s04).
 *
 * `spec/ui/mobile/navigation.md:52` — "the next event and the nearest due task
 * as compact rows, each tapping through to its detail… It is a pulse affordance:
 * chat is home, so the one glanceable 'what's next' surface rides above the
 * channel list rather than living in a Home tab."
 *
 * Drawn at `canvas-screens.dc.html:117-131`: an `UP NEXT` eyebrow, then two
 * rows separated by a hairline, each a glyph + title + `· context` with a
 * trailing time. The event's trailing time is gold; an imminent task due date is
 * `semantic.destructive`, which is the drawn `#F85149` — **not** the mention red
 * `#E5484D`, which `foundations.md:67` reserves for direct address alone.
 *
 * The two rows render independently: a chapter with events but no open tasks
 * still gets its event row. With neither, the strip renders nothing at all
 * rather than an empty-state card — it is chrome above the real content, and an
 * "everything is clear" card would push the channel list down to say nothing.
 */

/** Minimal shapes — the generated SDK types for these routes infer as `never`. */
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
      const at = new Date(startTime).getTime();
      if (Number.isNaN(at) || at < now.getTime()) return null;
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
 */
export function selectNextTask(tasks: unknown): UpNextTask | null {
  const open = asArray(tasks)
    .map((row) => {
      const id = str(row, "id");
      const title = str(row, "title");
      const dueDate = str(row, "due_date");
      const status = str(row, "status") ?? "TODO";
      if (!id || !title || !dueDate) return null;
      if (status === "COMPLETED") return null;
      const at = new Date(dueDate).getTime();
      if (Number.isNaN(at)) return null;
      return { at, task: { id, title, due_date: dueDate, status } };
    })
    .filter((entry): entry is { at: number; task: UpNextTask } => !!entry);

  open.sort((a, b) => a.at - b.at);
  return open[0]?.task ?? null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole calendar days between two instants, ignoring time of day. */
function dayDelta(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/** Today shows a clock time; anything further out shows the day instead. */
export function formatEventTime(startTime: string, now: Date): string {
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return "";
  const days = dayDelta(now, start);
  const clock = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (days === 0) return clock;
  if (days === 1) return `tmrw ${clock}`;
  if (days < 7) {
    return `${start.toLocaleDateString(undefined, { weekday: "short" })} ${clock}`;
  }
  return start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * A task due date as an instant.
 *
 * `tasks.due_date` is a bare `YYYY-MM-DD`, which `new Date()` reads as UTC
 * **midnight** — the previous local day for everyone west of Greenwich. Fed to
 * the local-calendar `dayDelta` below, that made every due date land one day
 * early: a task due Saturday painted `destructive` on Thursday for every US
 * user. UTC noon is the fix `lib/more/service-hours.ts` already documents.
 *
 * A full timestamp is passed through untouched, because the chat `kind:"task"`
 * card can carry one and forcing `T12:00:00Z` onto it would produce `NaN`.
 */
function parseDueInstant(value: string): Date | null {
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(bare ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDueDate(dueDate: string, now: Date): string {
  const due = parseDueInstant(dueDate);
  if (!due) return "";
  const days = dayDelta(now, due);
  if (days < 0) return "overdue";
  if (days === 0) return "due today";
  if (days === 1) return "due tmrw";
  if (days < 7) {
    return `due ${due.toLocaleDateString(undefined, { weekday: "short" })}`;
  }
  return `due ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** Due today, tomorrow, or already past — the states drawn in red. */
export function isDueUrgent(dueDate: string, now: Date): boolean {
  const due = parseDueInstant(dueDate);
  if (!due) return false;
  return dayDelta(now, due) <= 1;
}

export function UpNextStrip({ events, tasks, now }: UpNextStripProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();

  // `now` is read once per render rather than per row, so the two rows cannot
  // straddle a tick and disagree about what "today" means.
  const at = useMemo(() => now ?? new Date(), [now]);
  const event = useMemo(() => selectNextEvent(events, at), [events, at]);
  const task = useMemo(() => selectNextTask(tasks), [tasks]);

  if (!event && !task) return null;

  return (
    <View style={styles.strip}>
      <Text style={styles.eyebrow}>UP NEXT</Text>

      {event ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${event.name}, ${formatEventTime(event.start_time, at)}`}
          accessibilityHint="Open event details."
          // Carries the id since C2 (#994). C1 pushed the bare literal because
          // s07 was a hardcoded screen that could not consume one — an honest
          // seam at the time, and this is the slice that closes it. The
          // `pathname:` object form is covered by `lib/routes.spec.ts`.
          onPress={() =>
            router.push({
              pathname: "/event-details",
              params: { id: event.id },
            })
          }
          style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
        >
          <View style={styles.eventGlyph} />
          <Text numberOfLines={1} style={styles.rowText}>
            <Text style={styles.rowTitle}>{event.name}</Text>
            {event.location ? (
              <Text style={styles.rowContext}>{` · ${event.location}`}</Text>
            ) : null}
          </Text>
          <Text style={styles.eventTime}>
            {formatEventTime(event.start_time, at)}
          </Text>
        </Pressable>
      ) : null}

      {event && task ? <View style={styles.divider} /> : null}

      {task ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${task.title}, ${formatDueDate(task.due_date, at)}`}
          accessibilityHint="Open the task board."
          onPress={() => router.push("/tasks")}
          style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
        >
          <View style={styles.taskGlyph} />
          <Text numberOfLines={1} style={styles.rowText}>
            <Text style={styles.rowTitle}>{task.title}</Text>
            <Text style={styles.rowContext}>{" · task"}</Text>
          </Text>
          <Text
            style={
              isDueUrgent(task.due_date, at) ? styles.dueUrgent : styles.dueCalm
            }
          >
            {formatDueDate(task.due_date, at)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    strip: {
      gap: tokens.spacing.xs,
    },
    eyebrow: {
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      // The strip's rows are drawn tighter than a standalone control, so the
      // 44pt floor is met by minHeight rather than by padding.
      minHeight: tokens.touch.minimum,
    },
    pressed: {
      opacity: 0.6,
    },
    // TODO-DESIGN: the Canvas draws a duotone calendar and check-circle here.
    // `components/tab-glyphs.tsx` owns the four tab glyphs only, and inventing
    // two more off-recipe is worse than a neutral placeholder — the nearest
    // pattern is the tinted dot the check-in card uses (canvas s07).
    eventGlyph: {
      width: 9,
      height: 9,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.gold.house,
    },
    taskGlyph: {
      width: 9,
      height: 9,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.text.muted,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    rowContext: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
    },
    eventTime: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.gold.askText,
    },
    dueUrgent: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    dueCalm: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    divider: {
      height: 1,
      backgroundColor: tokens.color.border.hairline,
    },
  });
}
