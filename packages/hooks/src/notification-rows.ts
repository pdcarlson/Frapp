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
