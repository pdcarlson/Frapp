import { formatDay, formatDayTime } from "@repo/formatting";
import { memberLabel } from "@repo/hooks/display-names";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { asArray } from "@/lib/utils";

/**
 * What the Find dialog lists, built from the channel list and one `/v1/search`
 * payload. Pure, so the ranking, the per-group caps and every date hint are
 * testable without rendering the dialog.
 *
 * **Group order is Channels, Members, Messages, Events, Backwork.** The first
 * three are the board's ranking (`1d` pins 2-4): channels are where a member
 * goes most, and they come from the channel list the member can already read,
 * because `/v1/search` has no channel source. Events and Backwork were left
 * out of the old top-bar dropdown to keep it small; the dialog has the room,
 * and leaving them out meant a backwork title search answered "No matches."
 * while the file existed (2026-11-05).
 *
 * **Every dated thing carries its date** (Paul, 2026-11-05): a message its
 * sent day, an event its start, a backwork file its term and the day it was
 * added. Channels and members are places and people, so they carry their
 * category and email instead.
 */

export const FIND_GROUPS = [
  "Channels",
  "Members",
  "Messages",
  "Events",
  "Backwork",
] as const;

export type FindGroup = (typeof FIND_GROUPS)[number];

/** `"All"`, or one group to narrow the list to. */
export type FindFilter = "All" | FindGroup;

export type FindResult = {
  id: string;
  group: FindGroup;
  label: string;
  hint?: string;
  href: string;
};

type ChannelRow = {
  id?: string;
  name?: string | null;
  category?: string | null;
};

type MemberRow = {
  user_id?: string;
  display_name?: string | null;
  email?: string | null;
};

type MessageRow = {
  id?: string;
  content?: string | null;
  channel_id?: string | null;
  created_at?: string | null;
};

type EventRow = {
  id?: string;
  name?: string | null;
  start_time?: string | null;
};

type BackworkRow = {
  id?: string;
  title?: string | null;
  department_id?: string | null;
  course_number?: string | null;
  semester?: string | null;
  year?: number | null;
  created_at?: string | null;
};

type DepartmentRow = { id?: string; code?: string | null };

/** Per-group cap under "All". The list is a shortlist, not a results page. */
export const ALL_GROUP_LIMIT = 5;
/**
 * Cap once narrowed to one group. The server returns at most 10 per source
 * (`SEARCH_LIMIT` in `search.service.ts`), so this shows all of them; channels
 * are matched here and are capped the same way.
 */
export const SINGLE_GROUP_LIMIT = 10;

const MESSAGE_PREVIEW_CHARS = 120;

function joinHint(parts: Array<string | null | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => !!p && p.trim() !== "");
  return kept.length > 0 ? kept.join(" · ") : undefined;
}

/** `"COGS 101 · Fall 2025 · added Sep 14"`, each part only when known. */
export function backworkHint(
  row: BackworkRow,
  departmentCodes: Map<string, string>,
  now: Date = new Date(),
): string | undefined {
  const code = row.department_id
    ? departmentCodes.get(row.department_id)
    : undefined;
  const course = [code, row.course_number].filter(Boolean).join(" ") || null;
  const term =
    [row.semester, row.year != null ? String(row.year) : null]
      .filter(Boolean)
      .join(" ") || null;
  const added = formatDay(row.created_at, now);
  return joinHint([course, term, added ? `added ${added}` : null]);
}

export type FindInput = {
  query: string;
  filter: FindFilter;
  channels: unknown;
  payload: unknown;
  departments?: unknown;
  /** Groups the chapter has switched off (a module gate), never listed. */
  hiddenGroups?: ReadonlySet<FindGroup>;
  now?: Date;
};

export function buildFindResults({
  query,
  filter,
  channels,
  payload,
  departments,
  hiddenGroups,
  now = new Date(),
}: FindInput): FindResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const limit = filter === "All" ? ALL_GROUP_LIMIT : SINGLE_GROUP_LIMIT;
  const wants = (group: FindGroup) =>
    !hiddenGroups?.has(group) && (filter === "All" || filter === group);

  const bag =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const channelRows = asArray<ChannelRow>(channels);
  const out: FindResult[] = [];

  if (wants("Channels")) {
    let count = 0;
    for (const row of channelRows) {
      const name = row.name ?? "";
      if (!name.toLowerCase().includes(needle)) continue;
      out.push({
        id: `channel-${row.id ?? name}`,
        group: "Channels",
        label: name,
        hint: row.category ?? undefined,
        href: chatDeepLink({ channelId: row.id }),
      });
      if (++count >= limit) break;
    }
  }

  if (wants("Members")) {
    for (const row of asArray<MemberRow>(bag.members).slice(0, limit)) {
      out.push({
        id: `member-${row.user_id ?? row.display_name ?? out.length}`,
        group: "Members",
        label: memberLabel(row.display_name, row.user_id),
        hint: row.email ?? undefined,
        href: "/members",
      });
    }
  }

  if (wants("Messages")) {
    // Resolve the channel name rather than showing a member a raw UUID.
    const channelNames = new Map(
      channelRows.map((c) => [c.id, c.name ?? null]),
    );
    for (const row of asArray<MessageRow>(bag.messages).slice(0, limit)) {
      const channelName = row.channel_id
        ? channelNames.get(row.channel_id)
        : undefined;
      const content = row.content?.trim();
      out.push({
        id: `message-${row.id ?? out.length}`,
        group: "Messages",
        label: content
          ? content.slice(0, MESSAGE_PREVIEW_CHARS)
          : "Message with no text",
        hint: joinHint([
          channelName ? `#${channelName}` : null,
          formatDay(row.created_at, now),
        ]),
        href: chatDeepLink({ channelId: row.channel_id, messageId: row.id }),
      });
    }
  }

  if (wants("Events")) {
    for (const row of asArray<EventRow>(bag.events).slice(0, limit)) {
      out.push({
        id: `event-${row.id ?? out.length}`,
        group: "Events",
        label: row.name?.trim() || "Untitled event",
        hint: formatDayTime(row.start_time, now) ?? undefined,
        href: "/events",
      });
    }
  }

  if (wants("Backwork")) {
    const codes = new Map<string, string>();
    for (const d of asArray<DepartmentRow>(departments)) {
      if (d.id && d.code) codes.set(d.id, d.code);
    }
    for (const row of asArray<BackworkRow>(bag.backwork).slice(0, limit)) {
      out.push({
        id: `backwork-${row.id ?? out.length}`,
        group: "Backwork",
        label: row.title?.trim() || "Untitled file",
        hint: backworkHint(row, codes, now),
        href: "/backwork",
      });
    }
  }

  return out;
}
