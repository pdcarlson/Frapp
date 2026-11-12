import { foldMentionName } from "./mentions";
import { can } from "./permissions";

/**
 * The chapter's Everyone role (#4191, Paul 2026-11-11: "@members should just
 * be @everyone in my opinion, and there should not be a member role").
 *
 * It is the role that used to be called Member, kept under its rename-proof
 * key (`roles.system_key = 'MEMBER'`) so every stored reference to it keeps
 * working: members' `role_ids`, invites, `default_invite_role_id`, channel
 * lists and mobile builds already in the store. It is held by exactly the
 * members who held Member and sits in the same tier, so nobody's access or
 * rank moved. What changed is that no list, chip, filter or picker offers it,
 * nobody assigns or removes it, and pinging it means `@everyone`
 * (`spec/behavior/rbac.md` § The Everyone role).
 */
export const EVERYONE_ROLE_SYSTEM_KEY = "MEMBER";

/** The Everyone role's name. Fixed: the API refuses to rename it. */
export const EVERYONE_ROLE_NAME = "Everyone";

/** How the mention picker writes it: `@everyone`, as Discord does. */
export const EVERYONE_MENTION_NAME = "everyone";

/**
 * `@here`: the members of the channel who are online right now, as Slack and
 * Discord have it (2026-11-12). Not a role: the API reads who is online off
 * the chapter's presence when the message lands, and the Everyone role's
 * switch says who may use it, as one Discord permission covers both
 * (`spec/behavior/chat/README.md` § Role mentions).
 */
export const HERE_MENTION_NAME = "here";

/**
 * Whether a role row is the chapter's Everyone role. Read defensively, since
 * `GET /v1/roles` declares no response schema.
 */
export function isEveryoneRole(role: unknown): boolean {
  return (
    !!role &&
    typeof role === "object" &&
    (role as Record<string, unknown>).system_key === EVERYONE_ROLE_SYSTEM_KEY
  );
}

/**
 * The chapter-wide mention a role name would read as, `everyone` or `here`,
 * or `null` when it reads as neither. The API refuses either name for a new
 * or renamed role (the Everyone role keeps its own), since the token would
 * stop reaching what it says.
 */
export function reservedMentionName(
  name: string,
): typeof EVERYONE_MENTION_NAME | typeof HERE_MENTION_NAME | null {
  const folded = foldMentionName(name);
  if (folded === EVERYONE_MENTION_NAME) return EVERYONE_MENTION_NAME;
  if (folded === HERE_MENTION_NAME) return HERE_MENTION_NAME;
  return null;
}

/** A row of `GET /v1/channels/mention-roles`, as far as {@link withHereMention} reads it. */
export interface HereMentionSource {
  role_id: string;
  name: string;
  mentionable: boolean;
}

/**
 * The mention roles with `@here` added right after `@everyone`, for both
 * pickers and the chip test. It follows `@everyone`'s `mentionable`, which is
 * the Everyone role's switch, the rule the API applies when the message lands
 * (`ChatMentionService`). The API's list leaves it out because `role_id` is a
 * role's uuid and `@here` is not a role; its row here takes a client-only id.
 * No `@everyone` row (the legacy gap with no Everyone role) adds none.
 */
export function withHereMention<R extends HereMentionSource>(
  roles: readonly R[],
): R[] {
  const at = roles.findIndex((role) => role.name === EVERYONE_MENTION_NAME);
  if (at === -1) return [...roles];
  const everyone = roles[at]!;
  const here: R = {
    ...everyone,
    role_id: `${everyone.role_id}:${HERE_MENTION_NAME}`,
    name: HERE_MENTION_NAME,
  };
  return [...roles.slice(0, at + 1), here, ...roles.slice(at + 1)];
}

/**
 * What a mention picker's role row says at its end: `@everyone` and `@here`
 * say who they reach, as Slack's and Discord's pickers do, and any other role
 * says "Role".
 */
export function mentionRoleHint(name: string): string {
  const reserved = reservedMentionName(name);
  if (reserved === EVERYONE_MENTION_NAME) return "Notifies the whole channel";
  if (reserved === HERE_MENTION_NAME) return "Notifies who's online";
  return "Role";
}

/** The seeded roles that rank below Everyone: making someone one of these
 * takes Everyone away, as unticking Member used to. */
const BELOW_EVERYONE_SYSTEM_KEYS: ReadonlySet<unknown> = new Set([
  "NEW_MEMBER",
  "ALUMNI",
]);

/** A role row as {@link rolesAfterSave} reads it. */
export interface EveryoneSaveRole {
  id: string;
  system_key?: string | null;
  permissions?: readonly string[] | null;
}

/**
 * The role ids a member ends up with when a save asks for `requested` (#4191).
 * Nobody ticks or unticks Everyone: the clients don't offer it, and a mobile
 * build already in the store draws it as a chip whose tap must not move it.
 * So whatever the save sent, Everyone follows what the save means, read from
 * the roles it leaves the member with:
 *
 * - **Never beside New Member or Alumni**, which rank below it: graduating a
 *   member used to mean unticking Member and ticking Alumni, and an alumnus
 *   or a pledge must not keep what members get. This holds whatever those
 *   roles carry, so a chapter that took `members:view` off them still
 *   demotes.
 * - **Given** when the save takes the member's last New Member or Alumni role
 *   away (a pledge made a member, a chair or both), and when it leaves them
 *   no role granting member access (`members:view` or `*`, as
 *   `memberAccessRoleIds` reads it), the way a redeem has always added it and
 *   the way Discord leaves a member with no roles holding `@everyone`.
 * - **Kept as held** otherwise, so a member made a chair keeps it, and one
 *   who never held it (an officer invited straight into their role) isn't
 *   handed it.
 *
 * A chapter with no Everyone role (the legacy `system_key` gap) gets
 * `requested` unchanged. The API applies this to every
 * `PATCH /v1/members/:id/roles`; web's member sheet and mobile's roles sheet
 * apply it before asking whether a save takes access away.
 */
export function rolesAfterSave(
  requested: readonly string[],
  held: readonly string[],
  roles: readonly EveryoneSaveRole[],
): string[] {
  const everyone = roles.find(isEveryoneRole);
  if (!everyone) return [...requested];
  const others = requested.filter((id) => id !== everyone.id);
  const byId = new Map(roles.map((role) => [role.id, role]));
  const isLower = (id: string) =>
    BELOW_EVERYONE_SYSTEM_KEYS.has(byId.get(id)?.system_key);
  if (others.some(isLower)) return others;
  const withEveryone = requested.includes(everyone.id)
    ? [...requested]
    : [...others, everyone.id];
  const leftLower = held.some(isLower);
  const givesAccess = others.some((id) =>
    can("members:view", byId.get(id)?.permissions),
  );
  if (leftLower || !givesAccess) return withEveryone;
  return held.includes(everyone.id) ? withEveryone : others;
}
