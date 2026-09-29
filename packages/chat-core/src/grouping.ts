/**
 * How a chat thread groups into runs: the one statement of the compact layout's
 * grouping rules, shared by web and mobile so the two surfaces cannot drift
 * (`spec/ui/design-system/components.md` §11 § Grouping, owner decision
 * 2026-09-29, #2873).
 *
 * A **run** is consecutive messages from one author that draw one author line
 * (avatar, name, time) on their first row; the rows after it are just text.
 * A **day divider** sits above the first row of each local calendar day, and is
 * the only place a date appears in the thread.
 */
import { dayDelta, parseInstant } from "@repo/formatting";
import { isCardMessage } from "./message-actions";

/**
 * A follow-on joins the run above only when it was sent less than this long
 * after the row above it. Measured from the previous row, not from the run's
 * first row, so a steady conversation stays one run.
 */
export const GROUPING_WINDOW_MS = 5 * 60 * 1000;

/** The identity fields a message carries about whoever wrote it. */
export interface MessageAuthorKey {
  /** `users.id`, or `null` when the author is not a Frapp user. */
  sender_id: string | null;
  /** The author's id in the source system, for imported rows. */
  author_external_id?: string | null;
  /** Denormalised display name for a message with no `sender_id`. */
  author_name?: string | null;
}

/**
 * A stable identity key for "did the same person write both of these?".
 *
 * Comparing `sender_id` directly silently breaks with nullable senders, because
 * `null === null` is true in JavaScript: an imported channel where twenty
 * different Discord members spoke in turn would collapse into one run under one
 * name. The namespace prefixes matter too: without them a Frapp uuid and a
 * Discord snowflake could in principle collide, and the two are not the same
 * person.
 */
export function authorGroupingKey(author: MessageAuthorKey): string {
  if (author.sender_id) return `user:${author.sender_id}`;
  if (author.author_external_id) return `external:${author.author_external_id}`;
  const name = author.author_name?.trim();
  return name ? `name:${name}` : "unknown";
}

/** The fields the grouping rules read off a message. */
export interface GroupableMessage extends MessageAuthorKey {
  created_at: string;
  kind?: string | null;
  reply_to_id?: string | null;
  is_deleted?: boolean;
}

/** A row as the thread draws it: in full, or as a blocked member's tombstone. */
export interface GroupableRow<M extends GroupableMessage = GroupableMessage> {
  message: M;
  visibility: "visible" | "tombstone";
}

/**
 * The viewer's local calendar day, so "yesterday" breaks where the reader's day
 * breaks. `null` for an unparseable timestamp, which never equals another day.
 */
export function calendarDayKey(iso: string): string | null {
  const at = parseInstant(iso);
  if (!at) return null;
  return `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
}

/**
 * The day divider's label: `Today`, `Yesterday`, then the weekday, month and
 * day ("Sunday, Sep 28") in the viewer's locale, with the year when it is not
 * this one ("Tuesday, Mar 3, 2020") — the divider is the only date in the
 * thread, and an imported archive spans years. Empty for an unparseable
 * timestamp, so a divider never prints "Invalid Date". Calendar days are the
 * viewer's local ones (`dayDelta`, the shared arithmetic).
 */
export function dayDividerLabel(iso: string, now: Date = new Date()): string {
  const at = parseInstant(iso);
  if (!at) return "";
  const delta = dayDelta(at, now);
  if (delta === 0) return "Today";
  if (delta === 1) return "Yesterday";
  return at.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * Whether `row` starts a new run after `prev` (the row drawn directly above
 * it), per the table in `components.md` §11 § Grouping. `startsDay` is passed
 * in because `decorateThread` has already worked it out for the divider.
 */
function startsRun(
  prev: GroupableRow | undefined,
  row: GroupableRow,
  startsDay: boolean,
): boolean {
  if (!prev || startsDay) return true;
  const { message } = row;
  // Neither a tombstone nor a deleted message shows whose it was, so the row
  // after one has to.
  if (prev.visibility !== "visible" || prev.message.is_deleted) return true;
  if (authorGroupingKey(prev.message) !== authorGroupingKey(message)) {
    return true;
  }
  // The quote above a reply needs the author line under it.
  if (message.reply_to_id) return true;
  // A card is its own object in the channel; its author line says who ran it.
  if (isCardMessage(message) || isCardMessage(prev.message)) return true;
  const at = parseInstant(message.created_at);
  const before = parseInstant(prev.message.created_at);
  // A timestamp that cannot be read cannot be inside the window.
  if (!at || !before) return true;
  const gap = at.getTime() - before.getTime();
  // A negative gap (clock skew between an optimistic row and the server's
  // timestamp) still joins: it is the same burst, drawn out of order by
  // milliseconds.
  return gap >= GROUPING_WINDOW_MS;
}

export interface DecoratedRow<R extends GroupableRow> {
  row: R;
  /** Draw a day divider above this row. */
  startsDay: boolean;
  /** Draw the avatar and author line on this row. */
  startsRun: boolean;
}

/**
 * Decorates a thread, oldest first, with where its day dividers and runs
 * start. Pass only the rows that are drawn: a row the block list holds back is
 * not on screen, so it neither joins nor breaks a run.
 */
export function decorateThread<R extends GroupableRow>(
  rows: readonly R[],
): DecoratedRow<R>[] {
  return rows.map((row, index) => {
    const prev = rows[index - 1];
    const day = calendarDayKey(row.message.created_at);
    // A row whose timestamp cannot be read gets no divider, which would have
    // no label to print; it still starts a run (`startsRun`).
    const startsDay =
      day !== null &&
      (!prev || calendarDayKey(prev.message.created_at) !== day);
    return { row, startsDay, startsRun: startsRun(prev, row, startsDay) };
  });
}
