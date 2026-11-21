import { foldMentionName } from "./mentions";

/**
 * The chapter's Everyone role, the floor every member stands on (Paul,
 * 2026-11-21: "Everyone comes in as nothing and gets no access to any private
 * channels by default. Then we give them a role and all 3 of the base roles
 * provide access based on how the chapter set it up").
 *
 * Like Discord's `@everyone`, every member of the chapter holds it, always,
 * whatever else they hold. It sits outside the tiers, so it ranks below all
 * of them, and it gives only what anyone in the chapter may do: the directory
 * and the channels open to the whole chapter. No list, chip, filter or picker
 * offers it, nobody assigns or removes it, and pinging it means `@everyone`
 * (`spec/behavior/rbac.md` § The Everyone role).
 *
 * Until 2026-11-21 (#4191) "Everyone" was the old Member role renamed and
 * hidden, keyed `MEMBER` and sitting in the members' tier, so everyone who
 * joined landed as a full member. That row is now the Actives base role
 * ({@link ACTIVE_ROLE_SYSTEM_KEY}) and this one is new.
 */
export const EVERYONE_ROLE_SYSTEM_KEY = "EVERYONE";

/**
 * The Actives base role: the chapter's full members, brothers or sisters
 * (Paul, 2026-11-21, named "Actives" for new chapters; a chapter renames it).
 * The row that was the seeded Member role, and from #4191 to 2026-11-21 the
 * hidden Everyone role, keeps its `MEMBER` key, id, tier, permissions and
 * holders, so every stored reference to it (channel lists, events, invites)
 * now means the actives.
 */
export const ACTIVE_ROLE_SYSTEM_KEY = "MEMBER";

/**
 * Whether a role row is the Actives base role. It can't leave its tier
 * (the API answers `role.everyone_fixed`), so the role pages lock its tier.
 */
export function isActiveRole(role: unknown): boolean {
  if (!role || typeof role !== "object") return false;
  return (
    (role as Record<string, unknown>).system_key === ACTIVE_ROLE_SYSTEM_KEY
  );
}

/** The Actives role's seeded name in a new chapter. */
export const ACTIVE_ROLE_NAME = "Actives";

/**
 * The three base roles, one of which an officer gives each member: New
 * Member, Actives and Alumni (shown to Paul as new members, brothers and
 * grads). A member holds at most one; giving one takes the others away.
 */
export const BASE_ROLE_SYSTEM_KEYS = [
  "NEW_MEMBER",
  ACTIVE_ROLE_SYSTEM_KEY,
  "ALUMNI",
] as const;

/** Whether a role row is one of the three base roles. */
export function isBaseRole(role: unknown): boolean {
  if (!role || typeof role !== "object") return false;
  const key = (role as Record<string, unknown>).system_key;
  return (BASE_ROLE_SYSTEM_KEYS as readonly unknown[]).includes(key);
}

/** The Everyone role's name. Fixed: the API refuses to rename it. */
export const EVERYONE_ROLE_NAME = "Everyone";

/**
 * The heading chat's member list files a reader under when Everyone is the
 * highest role they hold: the rest of the chapter, as Discord's member list
 * puts everyone without a role shown apart under one plain group. "Everyone"
 * there would read as a role, and no list offers that role.
 */
export const EVERYONE_MEMBER_LIST_HEADING = "Members";

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
 * say who they reach, as Slack's and Discord's pickers do, and anything else
 * says what it is: "Role", "Tier" or "Group" (#4076), so a tier and a role
 * that share a name read apart. `kind` is the row's `kind` from
 * `GET /v1/channels/mention-roles`; an API from before tiers and groups were
 * pingable sends none, and every row it sends is a role.
 */
export function mentionRoleHint(name: string, kind?: string | null): string {
  const reserved = reservedMentionName(name);
  if (reserved === EVERYONE_MENTION_NAME) return "Notifies the whole channel";
  if (reserved === HERE_MENTION_NAME) return "Notifies who's online";
  if (kind === "tier") return "Tier";
  if (kind === "group") return "Group";
  return "Role";
}

/** A role row as {@link rolesAfterSave} reads it. */
export interface EveryoneSaveRole {
  id: string;
  system_key?: string | null;
  permissions?: readonly string[] | null;
}

/**
 * The role ids a member ends up with when a save asks for `requested`.
 *
 * - **Everyone is always held.** Nobody ticks or unticks it (no client offers
 *   it), so whatever the save sent, it comes back on the list, last.
 * - **One base role at most.** New Member, Actives and Alumni are one choice:
 *   a save that adds one takes away the others the member held, so making a
 *   pledge an active, or an active a grad, is one tap, as unticking Member and
 *   ticking Alumni used to be two. A save that sends several without adding
 *   any keeps them as sent, and the API refuses it (`role.base_conflict`).
 * - Nothing else is given or taken: a member with no base role keeps only
 *   Everyone, and an officer's roles stack on top of their base role.
 *
 * The API applies this to every `PATCH /v1/members/:id/roles`; web's member
 * sheet and mobile's roles sheet apply it before saving, so the list they
 * show is the list that lands.
 */
export function rolesAfterSave(
  requested: readonly string[],
  held: readonly string[],
  roles: readonly EveryoneSaveRole[],
): string[] {
  const everyone = roles.find(isEveryoneRole);
  const byId = new Map(roles.map((role) => [role.id, role]));
  const isBase = (id: string) => isBaseRole(byId.get(id));
  const others = [...new Set(requested.filter((id) => id !== everyone?.id))];
  const added = others.filter((id) => isBase(id) && !held.includes(id));
  const keep = added.length > 0 ? added[added.length - 1] : null;
  const settled = keep
    ? others.filter((id) => !isBase(id) || id === keep)
    : others;
  return everyone ? [...settled, everyone.id] : settled;
}

/** The base roles a role list holds, in list order. */
export function baseRoleIds(
  roleIds: readonly string[],
  roles: readonly EveryoneSaveRole[],
): string[] {
  const byId = new Map(roles.map((role) => [role.id, role]));
  return roleIds.filter((id) => isBaseRole(byId.get(id)));
}
