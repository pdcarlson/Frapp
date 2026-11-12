import { compareChannelOrder } from "@repo/hooks";
import { isSystemChannel } from "@repo/hooks/channel-start";
import { isDirectChannel } from "@repo/validation";
import type {
  ChannelCategorySummary,
  ChannelSummary,
} from "@/lib/chat/channel-list";

/**
 * The Arrange channels list (#3838): the chapter's order on the phone, as one
 * flat list of headings and rows, so a drag is a move from one index to
 * another. The default group (anything with no category) heads it, then each
 * category in the server's order, empty ones included so a row can be dropped
 * into one. DMs and the audit log are never in the chapter's order, as on
 * web's rail (`spec/behavior/chat/README.md` § Sidebar arrangement, "Chapter
 * order"), so they aren't here.
 */
export type ArrangeEntry =
  | {
      kind: "heading";
      key: string;
      categoryId: string | null;
      label: string;
    }
  | {
      kind: "channel";
      key: string;
      id: string;
      name: string;
      categoryId: string | null;
      isPrivate: boolean;
    };

/** The default group's heading, as Chat home names it. */
export const DEFAULT_GROUP_LABEL = "Channels";

export function arrangeEntries(
  channels: readonly ChannelSummary[],
  categories: readonly ChannelCategorySummary[],
): ArrangeEntry[] {
  const known = new Set(categories.map((category) => category.id));
  const byName = compareChannelOrder<ChannelSummary>((c) => c.name);
  const ordered = channels
    .filter((c) => !isDirectChannel(c) && !isSystemChannel(c))
    .slice()
    .sort(byName);
  const rowsFor = (categoryId: string | null): ArrangeEntry[] =>
    ordered
      .filter((c) =>
        categoryId === null
          ? c.category_id === null || !known.has(c.category_id)
          : c.category_id === categoryId,
      )
      .map((c) => ({
        kind: "channel" as const,
        key: `channel:${c.id}`,
        id: c.id,
        name: c.name,
        categoryId,
        isPrivate: c.type === "PRIVATE",
      }));
  return [
    {
      kind: "heading",
      key: "channels",
      categoryId: null,
      label: DEFAULT_GROUP_LABEL,
    },
    ...rowsFor(null),
    ...categories.flatMap((category): ArrangeEntry[] => [
      {
        kind: "heading",
        key: `category:${category.id}`,
        categoryId: category.id,
        label: category.name,
      },
      ...rowsFor(category.id),
    ]),
  ];
}

/** Where a held row from `from` lands for a drag of `rows` rows: never above the first heading. */
export function dropIndex(from: number, rows: number, count: number): number {
  return Math.max(1, Math.min(count - 1, from + rows));
}

/**
 * Moves the row at `from` to `to` and returns the new list and the one write
 * that saves it: the whole section it landed in, top to bottom, which also
 * moves it there from another section (`PUT /v1/channels/order` files every
 * listed channel under that category). `null` when nothing moved.
 */
export function moveChannelEntry(
  entries: readonly ArrangeEntry[],
  from: number,
  to: number,
): {
  entries: ArrangeEntry[];
  write: { category_id: string | null; channel_ids: string[] };
} | null {
  const held = entries[from];
  if (!held || held.kind !== "channel") return null;
  const target = dropIndex(from, to - from, entries.length);
  if (target === from) return null;
  const next = entries.slice();
  next.splice(from, 1);
  next.splice(target, 0, held);
  // The section is the nearest heading above where it landed.
  let headingAt = target;
  while (headingAt > 0 && next[headingAt]!.kind !== "heading") headingAt -= 1;
  const heading = next[headingAt]!;
  if (heading.kind !== "heading") return null;
  const categoryId = heading.categoryId;
  const ids: string[] = [];
  for (let i = headingAt + 1; i < next.length; i += 1) {
    const entry = next[i]!;
    if (entry.kind === "heading") break;
    ids.push(entry.id);
  }
  next[target] = { ...held, categoryId };
  return {
    entries: next,
    write: { category_id: categoryId, channel_ids: ids },
  };
}

/** The spoken position after a move, as web announces one. */
export function movedAnnouncement(
  entries: readonly ArrangeEntry[],
  index: number,
): string {
  const entry = entries[index];
  if (!entry || entry.kind !== "channel") return "";
  let headingAt = index;
  while (headingAt > 0 && entries[headingAt]!.kind !== "heading")
    headingAt -= 1;
  const heading = entries[headingAt]!;
  let total = 0;
  for (let i = headingAt + 1; i < entries.length; i += 1) {
    if (entries[i]!.kind === "heading") break;
    total += 1;
  }
  const label =
    heading.kind === "heading" ? heading.label : DEFAULT_GROUP_LABEL;
  return `${entry.name} moved to ${index - headingAt} of ${total} in ${label}`;
}

/**
 * The chapter's categories with one moved a place up (`-1`) or down (`1`),
 * for `PUT /v1/channels/categories/order` (#4478). `null` when it can't move
 * that way. The default group always heads the list and never moves.
 */
export function moveCategory(
  categoryIds: readonly string[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const from = categoryIds.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= categoryIds.length) return null;
  const next = categoryIds.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** The spoken position after a category moves, as web announces one. */
export function categoryMovedAnnouncement(
  categoryIds: readonly string[],
  label: string,
  id: string,
): string {
  return `${label} moved to ${categoryIds.indexOf(id) + 1} of ${categoryIds.length} categories`;
}
