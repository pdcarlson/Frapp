import { parseBareDateLocalMidnight } from "@repo/formatting";
import type { SearchHasTrait } from "@repo/hooks";

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
      let from = filter.from ? parseBareDateLocalMidnight(filter.from) : null;
      let to = filter.to ? parseBareDateLocalMidnight(filter.to) : null;
      if (from && to && from.getTime() > to.getTime()) [from, to] = [to, from];
      return {
        ...(from ? { after: from.toISOString() } : {}),
        ...(to ? { before: localMidnight(to, 1).toISOString() } : {}),
      };
    }
  }
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
 * A `from:` or `in:` the member is typing, when it is the last thing in the
 * box. It runs to the end of the text, so a name with a space in it
 * (`from:ada lov`) keeps narrowing the picker. Words before it stay the search
 * text.
 */
const TOKEN = /(^|\s)(from|in):([^:]*)$/i;

export function parseSearchToken(text: string): SearchToken | null {
  const match = TOKEN.exec(text);
  if (!match) return null;
  return {
    kind: match[2]!.toLowerCase() as SearchTokenKind,
    partial: match[3]!.trim().replace(/^[@#]/, ""),
    rest: text.slice(0, match.index + match[1]!.length),
  };
}

export interface SearchPickerOption {
  id: string;
  label: string;
}

/** Options whose label holds every typed word, ignoring case. */
export function matchPickerOptions(
  options: readonly SearchPickerOption[],
  partial: string,
): SearchPickerOption[] {
  const words = partial.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter((option) => {
    const label = option.label.toLowerCase();
    return words.every((word) => label.includes(word));
  });
}
