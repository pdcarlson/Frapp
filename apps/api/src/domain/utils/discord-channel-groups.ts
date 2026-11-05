/**
 * Which Frapp channel groups a Discord import puts its new channels into.
 *
 * The admin keeps a Discord category by giving each new channel in it the
 * category's name as its group (`new_channel_group`). When the import starts,
 * each name becomes one of the chapter's groups (`chat_channel_categories`):
 * the group of that name if the chapter has one, compared trimmed and in any
 * case, so "Committees" joins an existing "committees" rather than making a
 * second; otherwise a new group. New groups go after the chapter's own, in
 * Discord's category order on a bot import, and by name where Discord's order
 * is unknown (an upload).
 */
import type { DiscordImportChannel } from '../entities/discord-import.entity';
import { channelGroupKey, newChannelMergeKey } from './discord-channel-merge';

export { channelGroupKey };

/** What `start` needs to know about one of the chapter's groups. */
export interface ExistingChannelGroup {
  id: string;
  name: string;
  display_order: number;
}

export interface ChannelGroupPlan {
  /** Groups to create, in the order to create them, each with its place. */
  create: { key: string; name: string; display_order: number }[];
  /** Each group key already matched to one of the chapter's groups. */
  existing: Map<string, string>;
}

type GroupRow = Pick<
  DiscordImportChannel,
  | 'mapping_action'
  | 'new_channel_group'
  | 'new_channel_category_id'
  | 'discord_category_position'
>;

type PendingRow = GroupRow &
  Parameters<typeof newChannelMergeKey>[0] &
  Pick<DiscordImportChannel, 'target_channel_id'>;

/**
 * The rows whose group still has to be resolved: a `create_new` row naming a
 * group, with no group resolved yet and no channel made yet.
 *
 * A row whose channel exists is past the point a group matters, and so is a
 * row that will share a channel another row already made (#2856): a thread,
 * whose row never gets a target of its own, or a like-named sibling. So a
 * restart never makes a group again for a channel that already landed
 * somewhere.
 */
export function rowsNeedingGroup<T extends PendingRow>(
  rows: readonly T[],
): T[] {
  const made = new Set(
    rows.flatMap((row) => {
      const key = row.target_channel_id ? newChannelMergeKey(row) : null;
      return key ? [key] : [];
    }),
  );
  return rows.filter((row) => {
    if (
      row.mapping_action !== 'create_new' ||
      !row.new_channel_group?.trim() ||
      row.new_channel_category_id !== null ||
      row.target_channel_id !== null
    ) {
      return false;
    }
    const key = newChannelMergeKey(row);
    return key === null || !made.has(key);
  });
}

/**
 * Match each group the rows name to the chapter's groups, and order the rest.
 *
 * The first spelling a row uses names a new group. Its position is the lowest
 * Discord category position any row of it carries; a group with none sorts
 * after every positioned one, then all by name.
 */
export function planChannelGroups(
  rows: readonly GroupRow[],
  chapterGroups: readonly ExistingChannelGroup[],
): ChannelGroupPlan {
  const existing = new Map<string, string>();
  // Where two of the chapter's groups share a name, the first in the
  // chapter's order wins, as a member sees it first. `chapterGroups` comes in
  // that order (`findByChapter`), ties included, so it is not sorted again.
  const byKey = new Map<string, ExistingChannelGroup>();
  for (const group of chapterGroups) {
    const key = channelGroupKey(group.name);
    if (!byKey.has(key)) byKey.set(key, group);
  }

  const wanted = new Map<string, { name: string; position: number | null }>();
  for (const row of rows) {
    const name = row.new_channel_group?.trim();
    if (!name) continue;
    const key = channelGroupKey(name);
    const match = byKey.get(key);
    if (match) {
      existing.set(key, match.id);
      continue;
    }
    const position = row.discord_category_position;
    const seen = wanted.get(key);
    if (!seen) {
      wanted.set(key, { name, position });
    } else if (
      position !== null &&
      (seen.position === null || position < seen.position)
    ) {
      seen.position = position;
    }
  }

  const after =
    chapterGroups.reduce(
      (max, group) => Math.max(max, group.display_order),
      -1,
    ) + 1;
  const create = [...wanted.entries()]
    .sort(([, a], [, b]) => {
      if (a.position !== null && b.position !== null) {
        if (a.position !== b.position) return a.position - b.position;
      } else if (a.position !== null) {
        return -1;
      } else if (b.position !== null) {
        return 1;
      }
      return a.name.localeCompare(b.name, 'en-US');
    })
    .map(([key, { name }], index) => ({
      key,
      name,
      display_order: after + index,
    }));

  return { create, existing };
}
