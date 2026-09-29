import type { DiscordImportChannel } from '../entities/discord-import.entity';

/**
 * Which mapping rows of one import share the channel they create (#2856).
 *
 * Owner's decision: like-named channels merge by default. Two Discord channels
 * the admin sends to a new channel of the same name land in ONE Frapp channel,
 * provided they agree on everything that decides who reads it and how: the
 * type, the gate's permissions, and read-only. Rows that differ get a channel
 * each, as before, so a merge never widens who reads a message. The wizard
 * asks about a shared name whose rows differ before it sends one.
 *
 * The name compares the way the wizard's does (`normaliseChannelName` in
 * `apps/web/components/discord-import/mapping-issues.ts`): trimmed, any
 * leading `#` dropped, any case.
 *
 * Null for a row that creates nothing.
 */
export function newChannelMergeKey(
  mapping: Pick<
    DiscordImportChannel,
    | 'mapping_action'
    | 'new_channel_name'
    | 'new_channel_type'
    | 'new_channel_is_read_only'
    | 'new_channel_required_permissions'
  >,
): string | null {
  if (mapping.mapping_action !== 'create_new') return null;
  const name = (mapping.new_channel_name ?? '')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase();
  if (!name) return null;
  const permissions =
    mapping.new_channel_type === 'ROLE_GATED'
      ? [...(mapping.new_channel_required_permissions ?? [])].sort()
      : [];
  return JSON.stringify([
    name,
    mapping.new_channel_type,
    mapping.new_channel_is_read_only,
    permissions,
  ]);
}
