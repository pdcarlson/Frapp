/**
 * How one in-app notification row is drawn (#4346), shared by the web drawer
 * and mobile s14 so the two can't disagree about what a row is.
 *
 * Every row gets a picture: the person it is about (a chat sender, or the
 * member who joined) with a small badge naming the kind of notice, or, where
 * no person is behind it (a task, an event, a bill), a tile in the kind's own
 * hue. A row that mentions the viewer wears the @ badge in the mention chip's
 * fixed gold; it is not tinted (Shawn's pick, 2026-11-11: the list stays
 * flat, `components.md` § A list inside a drawer or popover is flat).
 *
 * Pure: no query. The caller passes the roster it already holds
 * (`useChapterRoster`, cached app-wide), so the notifications path adds no
 * read of its own (#3728).
 */
import type { NavGlyphName } from "@repo/theme/nav-glyphs";
import { dayDelta, parseInstantOrBareLocalNoon } from "@repo/formatting";
import {
  findMentionSpans,
  matchMentionCandidate,
  roleColor,
  spacedMentionNames,
  SYSTEM_SENDER_ID,
  withoutObjectReplacement,
  type MentionCandidate,
  type RoleColorHex,
} from "@repo/validation";

/**
 * What a row's badge or tile draws. A chat row is `mention` when it mentions
 * the viewer, whatever conversation it came from; otherwise the conversation's
 * kind, or `chat` for a row written before #4346, which doesn't say.
 */
export type NotificationKind =
  | "mention"
  | "dm"
  | "group"
  | "announcement"
  | "channel"
  | "chat"
  | "join"
  | "tasks"
  | "events"
  | "billing"
  | "points"
  | "service"
  | "reports"
  | "import"
  | "other";

/** A kind drawn as a tile: no person is behind the notice. */
export type NotificationTileKind = Exclude<
  NotificationKind,
  "mention" | "dm" | "group" | "announcement" | "channel" | "chat" | "join"
>;

/**
 * Each tile's hue, from the role palette so it sits beside the members'
 * colours rather than a second set. Never the chapter accent, which is not a
 * state (`foundations.md` §5).
 */
export const NOTIFICATION_TILE_HUE: Record<NotificationTileKind, RoleColorHex> =
  {
    tasks: roleColor("green"),
    events: roleColor("sky"),
    billing: roleColor("sand"),
    points: roleColor("lime"),
    service: roleColor("teal"),
    reports: roleColor("rose"),
    import: roleColor("slate"),
    other: roleColor("slate"),
  };

/** Each tile's glyph, from the shared nav set both surfaces draw. */
export const NOTIFICATION_TILE_GLYPH: Record<
  NotificationTileKind,
  NavGlyphName
> = {
  tasks: "tasks",
  events: "events",
  billing: "billing",
  points: "points",
  service: "service",
  reports: "reports",
  import: "folder",
  other: "activity",
};

/**
 * What the badge or tile says to a screen reader, which can't see it: read
 * before the title, so "Mentioned you: Ryan Castellano in #general".
 */
export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  mention: "Mentioned you",
  dm: "Direct message",
  group: "Group message",
  announcement: "Announcement",
  channel: "Channel message",
  chat: "Message",
  join: "New member",
  tasks: "Task",
  events: "Event",
  billing: "Dues",
  points: "Points",
  service: "Service hours",
  reports: "Report",
  import: "Discord import",
  other: "Notice",
};

/** The fields of a `GET /v1/notifications` row this module reads. */
export interface NotificationRowInput {
  title: string;
  body?: string | null;
  data?: unknown;
}

export interface NotificationLook {
  kind: NotificationKind;
  /**
   * The `users.id` the row is about, whose picture and name colour it wears:
   * `data.senderId` on a chat row, `data.memberUserId` on a join. `null` for
   * a tile. A chat row from the system sender (`SYSTEM_SENDER_ID`: the
   * audit bridge, poll-expiry notices, invite-accept DMs) is a tile too, as no
   * member sent it.
   */
  personId: string | null;
  /** Whether the row's message mentioned the viewer. */
  mentioned: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

const SCREEN_TILES: Record<string, NotificationTileKind> = {
  tasks: "tasks",
  events: "events",
  billing: "billing",
  points: "points",
  service: "service",
  // Suggested tasks to review (#4313) are task business.
  ai_suggestions: "tasks",
  chat_reports: "reports",
  discord_import: "import",
};

const CHAT_KINDS = new Set(["dm", "group", "announcement", "channel"]);

/** The roster's spaced names, worked out once per roster rather than per row. */
const NAMES_BY_ROSTER = new WeakMap<readonly MentionCandidate[], string[]>();
function namesOf(members: readonly MentionCandidate[]): string[] {
  let names = NAMES_BY_ROSTER.get(members);
  if (!names) {
    names = spacedMentionNames(members, []);
    NAMES_BY_ROSTER.set(members, names);
  }
  return names;
}

export function notificationLook(row: NotificationRowInput): NotificationLook {
  const data = isRecord(row.data) ? row.data : {};
  const target = isRecord(data.target) ? data.target : {};
  const screen = stringAt(target, "screen");

  if (screen === "chat") {
    const senderId = stringAt(data, "senderId");
    if (senderId === SYSTEM_SENDER_ID) {
      return { kind: "other", personId: null, mentioned: false };
    }
    // The server's answer only (`data.mentioned`, from the message's resolved
    // `mentions`), never the body re-read: a row written before #4346 doesn't
    // say, so it draws as a plain message (`components.md` § A row that
    // mentions you, "The list is the server's").
    const mentioned = data.mentioned === true;
    const chatKind = stringAt(data, "chatKind");
    const kind: NotificationKind = mentioned
      ? "mention"
      : chatKind && CHAT_KINDS.has(chatKind)
        ? (chatKind as NotificationKind)
        : "chat";
    return { kind, personId: senderId, mentioned };
  }
  if (screen === "members") {
    return {
      kind: "join",
      personId: stringAt(data, "memberUserId"),
      mentioned: false,
    };
  }
  return {
    kind: (screen && SCREEN_TILES[screen]) || "other",
    personId: null,
    mentioned: false,
  };
}

/** Whether a kind is drawn as a tile rather than a person's picture. */
export function isTileKind(
  kind: NotificationKind,
): kind is NotificationTileKind {
  return kind in NOTIFICATION_TILE_HUE;
}

/** A row's title as drawn: without U+FFFC, the "OBJ" box (#4346). */
export function notificationTitle(title: string): string {
  return withoutObjectReplacement(title).trim();
}

/**
 * A row's title split around the person's name, so the name can wear their
 * colour and the rest ("in #general", "joined") stays quiet. The server writes
 * the name first ("Ryan in #general", "Owen joined", a DM's bare name) or last
 * ("Announcement from Ryan"), so only those two places are tried: a name found
 * anywhere would colour "Ann" inside "Announcement". `null` when the name is
 * in neither place (no name yet, or one changed since).
 */
export function titleAroundName(
  title: string,
  name: string | null,
): { before: string; name: string; after: string } | null {
  if (!name) return null;
  // A whole word only: "Ann" must not take the start of "Announcement".
  const wordChar = /[\p{L}\p{N}\p{M}_]/u;
  if (title.startsWith(name) && !wordChar.test(title.charAt(name.length))) {
    return { before: "", name, after: title.slice(name.length) };
  }
  const start = title.length - name.length;
  if (title.endsWith(name) && !wordChar.test(title.charAt(start - 1))) {
    return {
      before: title.slice(0, title.length - name.length),
      name,
      after: "",
    };
  }
  return null;
}

export interface PreviewSegment {
  text: string;
  /** Drawn as chat's mention chip: an @-name that resolves to a member. */
  mention: boolean;
}

/**
 * A row's body, cleaned of U+FFFC (the "OBJ" box, #4346) and cut into runs,
 * with each @-name that resolves to a member of `members` as its own run, so
 * it draws as chat's mention chip. A token that names nobody stays text, as in
 * chat (`mentionChipFilter`). Without a roster yet, nothing is chipped.
 */
export function notificationPreview(
  body: string | null,
  members: readonly MentionCandidate[] | null,
): PreviewSegment[] {
  const text = withoutObjectReplacement(body ?? "").trim();
  if (!text) return [];
  if (!members || members.length === 0) return [{ text, mention: false }];
  const segments: PreviewSegment[] = [];
  let at = 0;
  for (const span of findMentionSpans(text, {
    names: namesOf(members),
    accept: (token) => matchMentionCandidate(members, token) !== null,
  })) {
    if (span.start > at) {
      segments.push({ text: text.slice(at, span.start), mention: false });
    }
    segments.push({ text: text.slice(span.start, span.end), mention: true });
    at = span.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at), mention: false });
  return segments;
}

/**
 * Where a row falls and what time it shows, on the viewer's own calendar day
 * (#1058): today's rows show a clock time ("4:00 PM"), a row from the last
 * week its weekday ("Mon"), and anything older its date ("Aug 12"). `null`
 * for a timestamp that doesn't parse, which drops the row on both surfaces.
 */
export function notificationWhen(
  createdAt: string,
  now: Date,
): { isToday: boolean; time: string } | null {
  // Full ISO timestamps pass through; a bare `YYYY-MM-DD` (not what the API
  // writes today) still keeps its calendar day east and west of Greenwich.
  const at = parseInstantOrBareLocalNoon(createdAt);
  if (!at) return null;
  const days = dayDelta(at, now);
  if (days === 0) {
    return {
      isToday: true,
      time: at.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    };
  }
  return {
    isToday: false,
    time:
      days < 7
        ? at.toLocaleDateString(undefined, { weekday: "short" })
        : at.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };
}

/** The inbox's Unread / All switch (#3948). */
export type NotificationFilter = "all" | "unread";

/** One entry in the inbox: a row on its own, or a conversation's rows. */
export interface NotificationEntry<Row> {
  /** Stable across refetches: the conversation's key, or the row's id. */
  key: string;
  /** The newest row, which the entry draws and opens. */
  lead: Row;
  /** Every row in the entry, newest first. */
  rows: Row[];
  /**
   * At least how many messages the entry stands for (see
   * `groupNotificationsBySource`). Only chat entries go above one.
   */
  messageCount: number;
  /**
   * Whether a row in the entry was a bundled burst ("3 new messages"), so
   * more messages may have been sent than any row records.
   */
  bundled: boolean;
  /** Ids of the entry's unread rows. */
  unreadIds: string[];
}

/**
 * The conversation a row collapses into, or `null` for a row that stands on
 * its own (#3948). Chat rows from one channel are one entry, as Slack's
 * Activity, Discord's Inbox and GroupMe's chat list show one line per
 * conversation; a thread's replies are their own entry, since they open the
 * thread. A row that mentions the viewer stands alone: it addresses them, the
 * way Slack lists each mention and Discord keeps a Mentions tab.
 */
export function notificationSourceKey(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const target = isRecord(data.target) ? data.target : null;
  if (!target || stringAt(target, "screen") !== "chat") return null;
  if (data.mentioned === true) return null;
  const channelId = stringAt(target, "channelId");
  if (!channelId) return null;
  const threadRootId = stringAt(target, "threadRootId");
  return threadRootId
    ? `chat:${channelId}:thread:${threadRootId}`
    : `chat:${channelId}`;
}

/**
 * The conversation a row's entry stands for, as a clear names it to the
 * server (#3948), or `null` for a row that stands on its own: the same rows
 * `notificationSourceKey` groups.
 */
export function notificationConversation(
  data: unknown,
): { channelId: string; threadRootId?: string } | null {
  if (!notificationSourceKey(data) || !isRecord(data)) return null;
  const target = data.target as Record<string, unknown>;
  const channelId = stringAt(target, "channelId") as string;
  const threadRootId = stringAt(target, "threadRootId");
  return threadRootId ? { channelId, threadRootId } : { channelId };
}

/** A bundled burst's `data.count`, or `null` for a row that isn't one. */
function bundleCount(data: unknown): number | null {
  if (!isRecord(data) || data.bundled !== true) return null;
  const count = data.count;
  return typeof count === "number" && Number.isInteger(count) && count > 1
    ? count
    : null;
}

function senderOf(data: unknown): string {
  return (isRecord(data) && stringAt(data, "senderId")) || "";
}

/**
 * At least how many messages `rows` stand for. The push worker bundles one
 * sender's burst (`burst-bundler.ts`): the first messages in a window push
 * one row each, the next pushes a bundle whose `count` is the window's total
 * so far ("3 new messages", covering those rows too), and later ones write
 * no row at all. So per sender, the larger of their row count and their
 * biggest bundle is a floor, never a sum, and the true number can be higher.
 */
function messageFloor(rows: readonly { data?: unknown }[]): number {
  const bySender = new Map<string, { rows: number; bundle: number }>();
  for (const row of rows) {
    const sender = senderOf(row.data);
    const seen = bySender.get(sender) ?? { rows: 0, bundle: 0 };
    seen.rows += 1;
    seen.bundle = Math.max(seen.bundle, bundleCount(row.data) ?? 0);
    bySender.set(sender, seen);
  }
  let total = 0;
  for (const seen of bySender.values())
    total += Math.max(seen.rows, seen.bundle);
  return total;
}

/**
 * The inbox's entries (#3948), shared by the web drawer and mobile s14:
 * `rows` (newest first) narrowed by `filter`, then one entry per conversation
 * (`notificationSourceKey`) and one per other row, in the order of each
 * entry's newest row. Under "unread" only unread rows count, so an entry's
 * `messageCount` is what is still new there. `messageCount` is a floor
 * (`messageFloor`): a bundled burst's later messages write no row.
 */
export function groupNotificationsBySource<
  Row extends { id: string; data?: unknown },
>(
  rows: readonly Row[],
  {
    isUnread,
    filter = "all",
  }: { isUnread: (row: Row) => boolean; filter?: NotificationFilter },
): NotificationEntry<Row>[] {
  const entries: NotificationEntry<Row>[] = [];
  const byKey = new Map<string, NotificationEntry<Row>>();
  for (const row of rows) {
    const unread = isUnread(row);
    if (filter === "unread" && !unread) continue;
    const source = notificationSourceKey(row.data);
    const existing = source ? byKey.get(source) : undefined;
    if (existing) {
      existing.rows.push(row);
      existing.bundled ||= bundleCount(row.data) !== null;
      if (unread) existing.unreadIds.push(row.id);
      continue;
    }
    const entry: NotificationEntry<Row> = {
      key: source ?? row.id,
      lead: row,
      rows: [row],
      messageCount: 1,
      bundled: bundleCount(row.data) !== null,
      unreadIds: unread ? [row.id] : [],
    };
    entries.push(entry);
    if (source) byKey.set(source, entry);
  }
  for (const entry of entries) entry.messageCount = messageFloor(entry.rows);
  return entries;
}

/**
 * The words under a conversation's entry ("14 messages", or "5+ messages"
 * when a bundled burst may have held more than its rows say), or `null` for
 * an entry of one row, whose own body already says what it is ("3 new
 * messages" on a bundle).
 */
export function notificationEntryCount(entry: {
  rows: readonly unknown[];
  messageCount: number;
  bundled: boolean;
}): string | null {
  if (entry.rows.length < 2 || entry.messageCount < 2) return null;
  return `${entry.messageCount}${entry.bundled ? "+" : ""} messages`;
}
