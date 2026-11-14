/**
 * The times a scheduled chat message can be set for (#4956), shared by web
 * and the phone. Slack's "Schedule for later" offers the same shape: a couple
 * of presets on the member's own clock, then a custom date and time.
 *
 * All of it runs on the device's clock and zone: a chapter has no zone of its
 * own, and what the API stores is the instant.
 */

/** What the presets send at: 9 AM, Slack's default. */
export const SCHEDULE_PRESET_HOUR = 9;
/** The furthest ahead the API takes a message, in days. */
export const SCHEDULE_MAX_DAYS = 120;

export interface SchedulePreset {
  key: "tomorrow" | "monday";
  label: string;
  at: Date;
}

function atHour(day: Date, hour: number): Date {
  const at = new Date(day);
  at.setHours(hour, 0, 0, 0);
  return at;
}

function addDays(day: Date, days: number): Date {
  const next = new Date(day);
  next.setDate(next.getDate() + days);
  return next;
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** "9:00 AM" in the device's locale. */
export function formatScheduleTime(at: Date): string {
  return timeFormat.format(at);
}

/**
 * Tomorrow at 9, and next Monday at 9 unless tomorrow is that Monday.
 */
export function schedulePresets(
  now: Date,
): [SchedulePreset, ...SchedulePreset[]] {
  const tomorrow = atHour(addDays(now, 1), SCHEDULE_PRESET_HOUR);
  // Days until the next Monday after today: 1 on a Sunday, 7 on a Monday.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  const monday = atHour(addDays(now, toMonday), SCHEDULE_PRESET_HOUR);
  const time = formatScheduleTime(tomorrow);
  const presets: [SchedulePreset, ...SchedulePreset[]] = [
    { key: "tomorrow", label: `Tomorrow at ${time}`, at: tomorrow },
  ];
  if (monday.getTime() !== tomorrow.getTime()) {
    presets.push({ key: "monday", label: `Monday at ${time}`, at: monday });
  }
  return presets;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * When a scheduled message goes, as a list row or a toast says it:
 * "Today at 8:00 AM", "Tomorrow at 9:00 AM", "Mon, Nov 16 at 9:00 AM", with
 * the year only when it isn't this one.
 */
export function formatScheduledFor(at: Date, now: Date): string {
  const time = formatScheduleTime(at);
  if (sameDay(at, now)) return `Today at ${time}`;
  if (sameDay(at, addDays(now, 1))) return `Tomorrow at ${time}`;
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(at);
  return `${day} at ${time}`;
}

/**
 * Why a custom time can't be used, or null when it can: the API refuses the
 * past and anything past 120 days.
 */
export function scheduleTimeProblem(at: Date, now: Date): string | null {
  if (Number.isNaN(at.getTime())) return "Pick a date and time.";
  if (at.getTime() <= now.getTime()) return "Pick a time in the future.";
  // In milliseconds, as the API counts it, not calendar days: across a
  // daylight-saving change those differ by an hour.
  if (at.getTime() > now.getTime() + SCHEDULE_MAX_DAYS * 86_400_000) {
    return `Pick a time within ${SCHEDULE_MAX_DAYS} days.`;
  }
  return null;
}

/** Why a scheduled message didn't post, for its row in the Scheduled list. */
export function scheduledFailureCopy(
  reason:
    "no_access" | "chapter_locked" | "not_sendable" | "send_failed" | null,
): string {
  switch (reason) {
    case "no_access":
      return "Not sent: you can no longer post here.";
    case "chapter_locked":
      return "Not sent: the chapter is read-only right now.";
    case "not_sendable":
      return "Not sent: this channel didn't take it.";
    default:
      return "Not sent.";
  }
}
