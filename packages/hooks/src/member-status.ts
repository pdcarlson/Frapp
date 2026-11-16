/**
 * The status a member picks for themselves (#3845), as both clients read
 * and write it. Pure, so the expiry and end-time rules are provable without a
 * clock or a server.
 *
 * Where it lives and what the API does with it: `spec/behavior/notifications.md`
 * § Do Not Disturb. How it shows: `spec/behavior/chat/README.md` § Online/offline
 * presence.
 */

export type MemberStatus = "online" | "idle" | "dnd" | "invisible";

/** The four fields `GET /v1/settings` serves, as much as this reads. */
export type MemberStatusSettings = {
  status?: string | null;
  status_expires_at?: string | null;
  custom_status?: string | null;
  custom_status_expires_at?: string | null;
};

/** What the member's own client acts on: the stored choice, expiry applied. */
export type OwnStatus = {
  status: MemberStatus;
  /** When `status` ends, ms since epoch, or `null` for "until I change it". */
  statusEndsAt: number | null;
  line: string | null;
  lineEndsAt: number | null;
};

function isMemberStatus(value: unknown): value is MemberStatus {
  return (
    value === "online" ||
    value === "idle" ||
    value === "dnd" ||
    value === "invisible"
  );
}

function endsAt(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The member's own status at `now`.
 *
 * The server already reads a status past its end time as Online, and a line
 * past its end time as none, but only when asked. A tab left open across the
 * end time holds the earlier answer, so the client applies the same rule to
 * what it holds, and `nextStatusChangeAt` says when to look again.
 */
export function ownStatusAt(
  settings: MemberStatusSettings,
  now: number,
): OwnStatus {
  const statusEndsAt = endsAt(settings.status_expires_at);
  const statusLive = statusEndsAt === null || statusEndsAt > now;
  const status =
    statusLive && isMemberStatus(settings.status) ? settings.status : "online";
  const lineEndsAt = endsAt(settings.custom_status_expires_at);
  const lineLive = lineEndsAt === null || lineEndsAt > now;
  const line = lineLive ? settings.custom_status?.trim() || null : null;
  return {
    status,
    statusEndsAt: status === "online" ? null : statusEndsAt,
    line,
    lineEndsAt: line === null ? null : lineEndsAt,
  };
}

/** The next moment `ownStatusAt` would answer differently, or `null`. */
export function nextStatusChangeAt(own: OwnStatus): number | null {
  const times = [own.statusEndsAt, own.lineEndsAt].filter(
    (t): t is number => t !== null,
  );
  return times.length > 0 ? Math.min(...times) : null;
}

/** DND's durations, in the menu's order. `null` is "Until I turn it off". */
export type DndDuration = "1h" | "8h" | "tomorrow" | null;

/** The custom line's "Clear after" choices. `null` is "Don't clear". */
export type LineDuration = "30m" | "1h" | "4h" | "today" | null;

/** "Today" is the default "Clear after" (#3845). */
export const DEFAULT_LINE_DURATION: LineDuration = "today";

/**
 * The hour "Until tomorrow" ends at, in the device's local zone: 8:00 AM, the same
 * morning the quiet-hours default window ends (`notifications.md` § Preference
 * sync), so a member who turns DND on for the night is reachable again at the
 * hour they'd expect.
 */
const TOMORROW_HOUR = 8;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** The next local midnight after `now`: the end of "Today". */
export function endOfToday(now: Date): Date {
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  return end;
}

/**
 * The next `TOMORROW_HOUR` in local time: tomorrow's, or this morning's when
 * it is still before that hour. A member who turns DND on at 12:30 AM means
 * "until the morning", not "until the morning after", which would silence a
 * whole day they never asked to lose.
 */
export function tomorrowMorning(now: Date): Date {
  const end = new Date(now);
  if (now.getHours() >= TOMORROW_HOUR) end.setDate(end.getDate() + 1);
  end.setHours(TOMORROW_HOUR, 0, 0, 0);
  return end;
}

/**
 * The end time to send for a DND duration, as an ISO instant (`Z` is the
 * explicit offset the API requires), or `null` for no end.
 *
 * Local-calendar arithmetic (`setDate`, `setHours`) is what puts "tomorrow" in
 * the device's local zone, including across a DST change; adding 24 hours would
 * land an hour off on those two nights.
 */
export function dndEndsAt(duration: DndDuration, now: Date): string | null {
  if (duration === null) return null;
  if (duration === "1h") return new Date(now.getTime() + HOUR).toISOString();
  if (duration === "8h")
    return new Date(now.getTime() + 8 * HOUR).toISOString();
  return tomorrowMorning(now).toISOString();
}

/** The end time to send for a custom line's "Clear after", or `null`. */
export function lineEndsAt(duration: LineDuration, now: Date): string | null {
  if (duration === null) return null;
  if (duration === "30m")
    return new Date(now.getTime() + 30 * MINUTE).toISOString();
  if (duration === "1h") return new Date(now.getTime() + HOUR).toISOString();
  if (duration === "4h")
    return new Date(now.getTime() + 4 * HOUR).toISOString();
  return endOfToday(now).toISOString();
}

/**
 * Characters a line may not hold: every control character (C0, DEL and C1,
 * which is what the API's `\p{Cc}` refuses, and which includes U+0085, a line
 * break) and the Unicode line and paragraph separators.
 */
// eslint-disable-next-line no-control-regex
const LINE_BREAKERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** A custom line's length the way the API counts it: code points. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Whether a typed line can be saved: one line (the input can't take a break,
 * but a paste can carry a separator) and within the cap once trimmed.
 */
export function lineProblem(value: string, max: number): string | null {
  if (LINE_BREAKERS.test(value)) {
    return "Keep it to one line.";
  }
  if (codePointLength(value.trim()) > max) {
    return `Keep it to ${max} characters.`;
  }
  return null;
}

/** The custom status line's cap, the same one the API and the column enforce. */
export const CUSTOM_STATUS_MAX = 80;

/** What each picked status is called, on both clients. */
export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  invisible: "Invisible",
};

/** The line under a status that needs one, on both clients. */
export const MEMBER_STATUS_HINT: Partial<Record<MemberStatus, string>> = {
  dnd: "Only urgent notifications ring",
  invisible: "You'll appear offline",
};

/**
 * DND's durations. "Until I turn it off" is the default (#3845), so it comes
 * first: on web, opening the submenu focuses it and Enter takes it; on mobile
 * it is the first choice under the row.
 */
export const DND_DURATIONS: { duration: DndDuration; label: string }[] = [
  { duration: null, label: "Until I turn it off" },
  { duration: "1h", label: "For 1 hour" },
  { duration: "8h", label: "For 8 hours" },
  { duration: "tomorrow", label: "Until tomorrow" },
];

/** "Clear after", in the order #3845 picked, Today the default. */
export const LINE_DURATIONS: { duration: LineDuration; label: string }[] = [
  { duration: "30m", label: "30 minutes" },
  { duration: "1h", label: "1 hour" },
  { duration: "4h", label: "4 hours" },
  { duration: "today", label: "Today" },
  { duration: null, label: "Don't clear" },
];

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const DAY_TIME = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** A clock time in the device's zone: "8:00 AM". */
export function clockTime(at: Date | number): string {
  return TIME.format(at);
}

/** "Until 3:45 PM" today, "Until Tue 8:00 AM" past today. */
export function untilLabel(endsAt: number, now: Date): string {
  const end = new Date(endsAt);
  const sameDay = end.toDateString() === now.toDateString();
  return `Until ${(sameDay ? TIME : DAY_TIME).format(end)}`;
}
