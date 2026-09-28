/**
 * How a Discord import turns Discord roles into Frapp channel gates (#2818).
 *
 * `ROLE_GATED` gates on permission strings, not on roles, so a channel gated
 * "Same as Discord" needs one permission per Frapp role that should read it.
 * Each mapped Frapp role gets its own read permission, `channels:read:<slug>`,
 * held by that role alone, and the channel requires any of them. A chapter
 * can edit the gate afterwards in chat admin like any other.
 *
 * The prefix keeps these apart from the system catalog, whose permissions
 * are all two-part (`channels:manage`), and marks what the string is for
 * where chat admin lists it beside the role that holds it.
 */
import type {
  DiscordRoleMapping,
  DiscordRoleMappingAction,
} from '../entities/discord-import.entity';

export const DISCORD_READ_PERMISSION_PREFIX = 'channels:read:';

/** Past this the slug is cut; the whole permission stays well under 100. */
const MAX_SLUG_LENGTH = 48;

const ACTIONS: ReadonlySet<DiscordRoleMappingAction> = new Set([
  'existing',
  'new',
  'ignore',
]);

/** A role name as the name checks compare it: trimmed, any case. */
export function roleNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** `Recording Secretary` → `recording-secretary`; empty when nothing is left. */
export function readPermissionSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * A read permission for a role named `name` that no string in `taken` already
 * is. A role named only in emoji has no slug, and reads `channels:read:role`.
 */
export function uniqueReadPermission(
  name: string,
  taken: ReadonlySet<string>,
): string {
  const base = `${DISCORD_READ_PERMISSION_PREFIX}${readPermissionSlug(name) || 'role'}`;
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The stored mapping, read defensively: it is jsonb, and a row written before
 * #2818 holds `signet_role_key` worksheet notes, which grant nothing and so
 * read as `ignore`.
 */
export function parseRoleMapping(raw: unknown): DiscordRoleMapping[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscordRoleMapping[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = record.discord_role_id;
    if (typeof id !== 'string' || id.length === 0) continue;
    const text = (value: unknown) =>
      typeof value === 'string' && value.length > 0 ? value : null;
    const action = ACTIONS.has(record.action as DiscordRoleMappingAction)
      ? (record.action as DiscordRoleMappingAction)
      : 'ignore';
    out.push({
      discord_role_id: id,
      discord_role_name: text(record.discord_role_name) ?? id,
      action,
      frapp_role_id: action === 'ignore' ? null : text(record.frapp_role_id),
      new_role_name: action === 'new' ? text(record.new_role_name) : null,
      read_permission:
        action === 'ignore' ? null : text(record.read_permission),
    });
  }
  return out;
}

/**
 * The gate of a channel imported "Same as Discord": the read permission of
 * each Frapp role mapped from one of its Discord readers, in reader order.
 * Ignored readers are left out, which only narrows the audience. Empty when
 * none is mapped, and such a channel cannot be "Same as Discord".
 */
export function sameAsDiscordGate(
  readerRoleIds: readonly string[],
  mapping: readonly DiscordRoleMapping[],
): string[] {
  const byRole = new Map(
    mapping.map((entry) => [entry.discord_role_id, entry]),
  );
  const gate: string[] = [];
  for (const roleId of readerRoleIds) {
    const permission = byRole.get(roleId)?.read_permission;
    if (permission && !gate.includes(permission)) gate.push(permission);
  }
  return gate;
}
