import { parseBareDateLocalMidnight } from "@repo/formatting";
import { filterChannelMembers, type SearchHasTrait } from "@repo/hooks";
import { dateFilterLabel } from "@repo/hooks/document-library";

/**
 * The pure half of the chat search filters (#3958): how a Date choice becomes
 * the two instants `GET /v1/search` takes, and how `from:` / `in:` typed in
 * the box is read. `chat-search-popover.tsx` draws them.
 */

export type SearchDatePreset = "any" | "today" | "7d" | "30d" | "custom";

export interface SearchDateFilter {
  preset: SearchDatePreset;
  /** `YYYY-MM-DD` from the custom range's first field; inclusive. */
  from?: string;
  /** `YYYY-MM-DD` from the custom range's second field; inclusive. */
  to?: string;
}

export const SEARCH_DATE_PRESETS: readonly {
  preset: SearchDatePreset;
  label: string;
}[] = [
  { preset: "any", label: "Any time" },
  { preset: "today", label: "Today" },
  { preset: "7d", label: "Last 7 days" },
  { preset: "30d", label: "Last 30 days" },
  { preset: "custom", label: "Custom" },
];

export const SEARCH_HAS_TRAITS: readonly {
  trait: SearchHasTrait;
  label: string;
}[] = [
  { trait: "file", label: "File" },
  { trait: "image", label: "Image" },
  { trait: "link", label: "Link" },
  { trait: "poll", label: "Poll" },
];

/**
 * A custom field's day, or `null` while it is unfinished. A date field reports
 * a complete value on every digit of the year (`0002`, `0020`, `0202`, `2026`),
 * and each would be a request of its own, the first three of them scans of
 * everything since the year 2. No message predates the product, so a year
 * before 2000 is a year still being typed.
 */
function customDay(value: string | undefined): Date | null {
  const day = value ? parseBareDateLocalMidnight(value) : null;
  return day && day.getFullYear() >= 2000 ? day : null;
}

/** Local midnight `days` calendar days from `day` (DST-safe: by date, not by 24h). */
function localMidnight(day: Date, days = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
}

/**
 * The `after` / `before` instants for a Date choice.
 *
 * The API refuses a bare date because it cannot know whose midnight is meant
 * (`iso-instant.ts`), so the member's own local midnight is resolved here and
 * sent as an instant. "Last 7 days" starts at local midnight seven days ago,
 * so it holds today and the seven days before it. A custom range is inclusive
 * at both ends: `before` is the midnight that ends the last day. Ends given
 * backwards are read in order, and an unfinished field is no bound.
 */
export function searchDateBounds(
  filter: SearchDateFilter,
  now: Date,
): { after?: string; before?: string } {
  switch (filter.preset) {
    case "any":
      return {};
    case "today":
      return { after: localMidnight(now).toISOString() };
    case "7d":
      return { after: localMidnight(now, -7).toISOString() };
    case "30d":
      return { after: localMidnight(now, -30).toISOString() };
    case "custom": {
      let from = customDay(filter.from);
      let to = customDay(filter.to);
      if (from && to && from.getTime() > to.getTime()) [from, to] = [to, from];
      return {
        ...(from ? { after: from.toISOString() } : {}),
        ...(to ? { before: localMidnight(to, 1).toISOString() } : {}),
      };
    }
  }
}

/**
 * The Date chip's value, or `null` when the choice narrows nothing: any time,
 * or a custom range with no finished date, which is a filter in waiting and
 * must not paint as set (`isActiveDateFilter`'s rule in Documents). A custom
 * range is named the way Documents names one, by the same function.
 */
export function searchDateLabel(filter: SearchDateFilter): string | null {
  if (filter.preset === "any") return null;
  if (filter.preset !== "custom") {
    return (
      SEARCH_DATE_PRESETS.find((entry) => entry.preset === filter.preset)
        ?.label ?? null
    );
  }
  let from = customDay(filter.from) ? (filter.from ?? null) : null;
  let to = customDay(filter.to) ? (filter.to ?? null) : null;
  if (!from && !to) return null;
  // In order, as `searchDateBounds` reads them: `YYYY-MM-DD` sorts as text.
  if (from && to && from > to) [from, to] = [to, from];
  return dateFilterLabel({ preset: "custom", from, to });
}

export type SearchTokenKind = "from" | "in";

export interface SearchToken {
  kind: SearchTokenKind;
  /** What follows the colon, less a leading `@` or `#`: the picker's filter. */
  partial: string;
  /** The box's text with the token taken off the end. */
  rest: string;
}

/**
 * A `from:` or `in:` the member may be typing: the word, something straight
 * after its colon (or nothing yet), and whatever follows to the end of the
 * box, so a name with a space in it (`from:ada lov`) keeps narrowing.
 *
 * This is only a candidate. Text is never dropped from the search without a
 * sign, so the panel treats it as a token only while what follows the colon
 * is one word or still matches an option (`isSearchToken`): `from:ada budget`
 * and `note from:bob re dues` are searched as typed, and so is `error in:
 * login page`, where a space follows the colon.
 */
const TOKEN = /(^|\s)(from|in):((?:\S[^:]*)?)$/i;

export function parseSearchToken(text: string): SearchToken | null {
  const match = TOKEN.exec(text);
  if (!match) return null;
  return {
    kind: match[2]!.toLowerCase() as SearchTokenKind,
    partial: match[3]!.trim().replace(/^[@#]/, ""),
    rest: text.slice(0, match.index + match[1]!.length),
  };
}

/**
 * Whether a candidate is a token: its filter is a single word, or it still
 * matches something to pick. Past that it is ordinary search text.
 */
export function isSearchToken(token: SearchToken, matches: number): boolean {
  return !/\s/.test(token.partial) || matches > 0;
}

export interface SearchPickerOption {
  id: string;
  label: string;
}

/**
 * Members matching what was typed, by the member column's own rule
 * (`filterChannelMembers`): every typed word starts a word of the name,
 * ignoring case and accents, so `jose` finds José here as it does there.
 */
export function matchMemberOptions(
  options: readonly SearchPickerOption[],
  partial: string,
): SearchPickerOption[] {
  return filterChannelMembers(
    options.map((option) => ({ name: option.label, option })),
    partial,
  ).map((row) => row.option);
}

/** Lowercased, accents dropped. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Channels whose name holds every typed word anywhere, ignoring case and
 * accents. Not the member rule: a channel name is free text (`exec_board`,
 * `📢┃announcements`), and word starts would hide `in:board` and
 * `in:announcements` behind separators nobody types.
 */
export function matchChannelOptions(
  options: readonly SearchPickerOption[],
  partial: string,
): SearchPickerOption[] {
  const words = fold(partial).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter((option) => {
    const label = fold(option.label);
    return words.every((word) => label.includes(word));
  });
}
