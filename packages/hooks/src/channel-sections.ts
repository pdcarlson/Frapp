/**
 * How a chat channel list divides into category sections, shared so web's rail
 * and mobile's s04 apply one rule instead of two copies free to disagree
 * (#1684). The behavior is owned by `spec/behavior/chat/README.md` § Channels
 * (the "Channel categories" rule): named groups, with anything unassigned in a default "Channels"
 * group. Labels, sorting inside a section, and any extra sections a client
 * draws (web's System group, both clients' Hidden conversations) stay with the
 * client.
 */

import { isDirectChannel } from "@repo/validation";

/** The fields the grouping reads off a channel row. */
export interface GroupableChannel {
  type: string;
  category_id?: string | null;
}

/** The fields the grouping reads off a `GET /v1/channels/categories/list` row. */
export interface GroupableCategory {
  id: string;
}

export interface ChannelSections<
  C extends GroupableChannel,
  K extends GroupableCategory,
> {
  /** Plain channels with no category, or one that is not in the list. */
  uncategorized: C[];
  /**
   * One entry per category, **in the order the categories were passed**, and
   * including categories no channel landed in, so a caller can tell an empty
   * category from a missing one. Renderers skip the empty ones.
   */
  categories: { category: K; channels: C[] }[];
  /** DMs and group DMs, whatever `category_id` they carry. */
  direct: C[];
}

/**
 * Buckets channels into the default group, one group per category, and the
 * direct-message group. Three rules, each one a bug if dropped:
 *
 * - **Order is the caller's array order**, for categories and for the channels
 *   inside every bucket. `SupabaseChatCategoryRepository.findByChapter` already
 *   orders categories by `display_order`, then `created_at`, so the list
 *   arrives in render order. Sorting here would be a second implementation of
 *   that rule. Nothing is sorted; a client that sorts rows inside a section
 *   does it on the result.
 * - **Type before category.** A DM or group DM goes to `direct` before its
 *   `category_id` is read, so a stray category on a DM row can't pull it out
 *   of the direct group. The API doesn't forbid the column on a DM row.
 * - **An unknown `category_id` falls back to `uncategorized`.** That covers a
 *   deleted category, or a stale categories cache. The row is never dropped,
 *   which matches what the admin screen promises on delete: "Channels in this
 *   category become uncategorized."
 */
export function groupChannelsByCategory<
  C extends GroupableChannel,
  K extends GroupableCategory,
>(
  channels: readonly C[],
  categories: readonly K[],
): ChannelSections<C, K> {
  const uncategorized: C[] = [];
  const direct: C[] = [];
  // Seeded from `categories` so a category with no channels still gets an
  // entry.
  const byCategory = new Map<string, C[]>(
    categories.map((category) => [category.id, []]),
  );

  for (const channel of channels) {
    if (isDirectChannel(channel)) {
      direct.push(channel);
      continue;
    }
    const bucket =
      channel.category_id != null
        ? byCategory.get(channel.category_id)
        : undefined;
    (bucket ?? uncategorized).push(channel);
  }

  return {
    uncategorized,
    categories: categories.map((category) => ({
      category,
      channels: byCategory.get(category.id) ?? [],
    })),
    direct,
  };
}
