import type { StagedChannel, StagedRole } from "./upload-step";

/**
 * What one Discord role becomes in Frapp (#2818): one of the chapter's roles,
 * a new role created when the import starts, or nothing.
 *
 * It decides who reads the channels imported "Same as Discord". It never puts
 * anyone into a role: imported authors are names on messages, not accounts.
 */
export type RoleChoice =
  | { action: "existing"; roleId: string }
  | { action: "new"; name: string }
  | { action: "ignore" };

/** A Frapp role as `GET /v1/roles` returns it, trimmed to what matching needs. */
export interface FrappRole {
  id: string;
  name: string;
  system_key: string | null;
}

/** Why a default was chosen, shown so a close match gets a second look. */
export type MatchKind = "same-name" | "close" | null;

/** `Vice-President` and `vice president` are the same name. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Words of a name, singular, without numbers: `Pledges 2026` → `pledge`. */
function words(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !/^\d+$/.test(word))
    .map((word) =>
      word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
        ? word.slice(0, -1)
        : word,
    );
}

/**
 * What a Discord role is commonly called, per seeded Frapp role, matched as
 * the END of the Discord name. The end is what a title is: "Recording
 * Secretary" is a secretary, but "Pledge Educator" is an educator, not a
 * pledge, and matching it to New Member would let every pledge read the
 * officer channels.
 */
const CLOSE_MATCHES: Record<string, string[]> = {
  VICE_PRESIDENT: ["vice president", "vp", "vice pres"],
  PRESIDENT: ["president", "pres"],
  TREASURER: ["treasurer"],
  SECRETARY: ["secretary"],
  NEW_MEMBER: [
    "new member",
    "pledge",
    "associate member",
    "associate",
    "neophyte",
    "candidate",
  ],
  ALUMNI: ["alumni", "alum", "alumnus", "alumna", "alumnae", "graduate"],
  MEMBER: ["member", "brother", "sister", "active"],
};

function endsWith(name: readonly string[], alias: readonly string[]): boolean {
  if (alias.length === 0 || alias.length > name.length) return false;
  const offset = name.length - alias.length;
  return alias.every((word, index) => name[offset + index] === word);
}

/**
 * The Frapp role a Discord role most plausibly is: the same name, ignoring
 * case and punctuation, then a close match to a seeded role by its
 * rename-proof `system_key`. The longest alias wins, so "Vice President" is
 * never read as President.
 */
export function matchFrappRole(
  discordName: string,
  frappRoles: readonly FrappRole[],
): { role: FrappRole; kind: Exclude<MatchKind, null> } | null {
  const key = nameKey(discordName);
  const same = frappRoles.find((role) => nameKey(role.name) === key);
  if (same) return { role: same, kind: "same-name" };

  const name = words(discordName);
  let best: { role: FrappRole; length: number } | null = null;
  for (const [systemKey, aliases] of Object.entries(CLOSE_MATCHES)) {
    const role = frappRoles.find(
      (candidate) => candidate.system_key === systemKey,
    );
    if (!role) continue;
    for (const alias of aliases) {
      const aliasWords = words(alias);
      if (!endsWith(name, aliasWords)) continue;
      if (!best || aliasWords.length > best.length) {
        best = { role, length: aliasWords.length };
      }
    }
  }
  return best ? { role: best.role, kind: "close" } : null;
}

/**
 * The starting answer for a Discord role (owner's decision on #2818): its
 * name match, else a new role if it could read a private channel (so that
 * channel can be imported "Same as Discord"), else Ignore, so colour, class
 * year and game roles create nothing. A viewer who cannot manage roles starts
 * everything at Ignore, the only mapping the API will take from them.
 */
export function defaultRoleChoice(
  role: StagedRole,
  frappRoles: readonly FrappRole[],
  readsPrivate: boolean,
  canManageRoles: boolean,
): { choice: RoleChoice; kind: MatchKind } {
  if (!canManageRoles) return { choice: { action: "ignore" }, kind: null };
  const match = matchFrappRole(role.roleName, frappRoles);
  if (match) {
    return {
      choice: { action: "existing", roleId: match.role.id },
      kind: match.kind,
    };
  }
  return {
    choice: readsPrivate
      ? { action: "new", name: role.roleName.trim() }
      : { action: "ignore" },
    kind: null,
  };
}

/** How many private channels each Discord role could read. */
export function privateReads(
  channels: readonly StagedChannel[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const channel of channels) {
    for (const roleId of channel.readerRoleIds ?? []) {
      counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
    }
  }
  return counts;
}

/** One thing on the role step that stops Continue. */
export interface RoleIssue {
  roleId: string;
  message: string;
}

/**
 * What the API would refuse, said before Continue: a new role needs a name,
 * and a name no Frapp role already has (it would be a second role of the same
 * name, so map to the existing one instead).
 */
export function roleIssues(
  roles: readonly StagedRole[],
  choices: Record<string, RoleChoice>,
  frappRoles: readonly FrappRole[],
  maxNameLength: number,
): RoleIssue[] {
  const existing = new Map(
    frappRoles.map((role) => [role.name.trim().toLowerCase(), role.name]),
  );
  const issues: RoleIssue[] = [];
  for (const role of roles) {
    const choice = choices[role.roleId];
    if (choice?.action !== "new") continue;
    const name = choice.name.trim();
    const clash = existing.get(name.toLowerCase());
    if (!name) {
      issues.push({
        roleId: role.roleId,
        message: `Name the new role for ${role.roleName}.`,
      });
    } else if (name.length > maxNameLength) {
      issues.push({
        roleId: role.roleId,
        message: `The new role for ${role.roleName} needs a shorter name (at most ${maxNameLength} characters).`,
      });
    } else if (clash) {
      issues.push({
        roleId: role.roleId,
        message: `A role named "${clash}" already exists. Map ${role.roleName} to it instead of creating a new one.`,
      });
    }
  }
  return issues;
}

/** Who a "Same as Discord" channel would be readable by, in Frapp's words. */
export interface SameAsDiscordReaders {
  /** Frapp roles, a new one marked; empty when none of its readers is mapped. */
  roles: string[];
  /** Discord roles that could read it but are set to Ignore. */
  ignored: string[];
}

/**
 * The Frapp side of a channel's Discord audience, or null when the scan
 * recorded none (a public channel, an upload, roles that could not be read,
 * or a channel hidden only by a deny, which every role but the denied one
 * reads by inheriting from `@everyone`), in which case "Same as Discord" is
 * not on offer at all.
 */
export function sameAsDiscordReaders(
  channel: StagedChannel,
  roles: readonly StagedRole[],
  choices: Record<string, RoleChoice>,
  frappRoles: readonly FrappRole[],
): SameAsDiscordReaders | null {
  if (
    channel.privateInDiscord !== true ||
    !channel.readerRoleIds ||
    channel.readerRoleIds.length === 0
  ) {
    return null;
  }
  const discordNames = new Map(
    roles.map((role) => [role.roleId, role.roleName]),
  );
  const frappNames = new Map(frappRoles.map((role) => [role.id, role.name]));
  const mapped: string[] = [];
  const ignored: string[] = [];
  for (const roleId of channel.readerRoleIds) {
    const choice = choices[roleId];
    const label =
      choice?.action === "existing"
        ? frappNames.get(choice.roleId)
        : choice?.action === "new"
          ? `${choice.name.trim()} (new)`
          : undefined;
    if (label) {
      if (!mapped.includes(label)) mapped.push(label);
    } else {
      ignored.push(discordNames.get(roleId) ?? roleId);
    }
  }
  return { roles: mapped, ignored };
}
