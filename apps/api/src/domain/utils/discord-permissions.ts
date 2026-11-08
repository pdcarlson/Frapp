/**
 * Discord's channel permission calculation, for three questions discovery asks
 * of every channel before any message is read:
 *
 *  1. can the bot read this channel's history at all,
 *  2. could every member of the server read it (or was it private), and
 *  3. could the people who read it talk in it, or was it read-only (#3697)?
 *
 * Why compute rather than probe. Discord returns EVERY guild channel to a bot,
 * including ones it cannot open, so the channel list says nothing about
 * access. The only other signal is a failed read, and `@discordjs/rest` counts
 * each 403 against Discord's 10,000-per-10-minutes invalid-request budget, the
 * budget that ONE bot token shares across every connected chapter. On the
 * first real server (78 channels, `@everyone` denied View Channels) probing
 * spent 76 of those on channels the bot could never read.
 *
 * This is Discord's documented algorithm ("Permission Overwrites"), in BigInt
 * throughout: the bitfield passes 2^53, and a rounded float would decide
 * access wrongly without any error.
 */

/** View Channels (1 << 10). */
export const VIEW_CHANNEL = 1n << 10n;
/** Send Messages (1 << 11); Create Posts in a forum. */
export const SEND_MESSAGES = 1n << 11n;
/** Send Messages in Threads (1 << 38): replying to a forum post. */
export const SEND_MESSAGES_IN_THREADS = 1n << 38n;
/** Read Message History (1 << 16). */
export const READ_MESSAGE_HISTORY = 1n << 16n;
/** Administrator (1 << 3): every permission, and overwrites do not apply. */
export const ADMINISTRATOR = 1n << 3n;

const ALL = ~0n;

/** A guild role, as `GET /guilds/{id}/roles` returns it. */
export interface DiscordRolePermissions {
  id: string;
  /** Decimal string, as Discord sends it. */
  permissions: string;
}

/** One entry of a channel's `permission_overwrites`. */
export interface DiscordPermissionOverwrite {
  id: string;
  /** 0 = role, 1 = member. */
  type: number;
  allow: string;
  deny: string;
}

/** The subject whose access is being computed. */
export interface DiscordPermissionSubject {
  /** User id, for a member-type overwrite. */
  userId: string | null;
  /** Role ids held, NOT including `@everyone` (whose id is the guild id). */
  roleIds: readonly string[];
}

function bits(value: string | null | undefined): bigint {
  if (typeof value !== 'string' || value.length === 0) return 0n;
  try {
    return BigInt(value);
  } catch {
    // Unparseable is not "no permissions we can see"; it is an answer we did
    // not understand. Callers treat it as zero, the side that reads nothing.
    return 0n;
  }
}

/** Guild-level permissions: `@everyone` plus every role held. */
export function basePermissions(
  guildId: string,
  roles: readonly DiscordRolePermissions[],
  subject: DiscordPermissionSubject,
): bigint {
  const byId = new Map(roles.map((role) => [role.id, bits(role.permissions)]));
  let permissions = byId.get(guildId) ?? 0n;
  for (const roleId of subject.roleIds) {
    permissions |= byId.get(roleId) ?? 0n;
  }
  return (permissions & ADMINISTRATOR) !== 0n ? ALL : permissions;
}

/** Channel-level permissions after the channel's overwrites. */
export function channelPermissions(
  base: bigint,
  guildId: string,
  overwrites: readonly DiscordPermissionOverwrite[],
  subject: DiscordPermissionSubject,
): bigint {
  if ((base & ADMINISTRATOR) !== 0n) return ALL;
  let permissions = base;

  const everyone = overwrites.find(
    (overwrite) => overwrite.type === 0 && overwrite.id === guildId,
  );
  if (everyone) {
    permissions &= ~bits(everyone.deny);
    permissions |= bits(everyone.allow);
  }

  // Role overwrites apply together: every deny, then every allow, so an allow
  // on any held role beats a deny on another held role.
  let allow = 0n;
  let deny = 0n;
  const held = new Set(subject.roleIds);
  for (const overwrite of overwrites) {
    if (overwrite.type !== 0 || !held.has(overwrite.id)) continue;
    allow |= bits(overwrite.allow);
    deny |= bits(overwrite.deny);
  }
  permissions &= ~deny;
  permissions |= allow;

  const member =
    subject.userId === null
      ? undefined
      : overwrites.find(
          (overwrite) =>
            overwrite.type === 1 && overwrite.id === subject.userId,
        );
  if (member) {
    permissions &= ~bits(member.deny);
    permissions |= bits(member.allow);
  }
  return permissions;
}

/** View Channels and Read Message History, both needed to read history. */
export function canReadHistory(permissions: bigint): boolean {
  return (
    (permissions & VIEW_CHANNEL) !== 0n &&
    (permissions & READ_MESSAGE_HISTORY) !== 0n
  );
}

/**
 * Whether every member of the server could read the channel's history. False
 * is what "private in Discord" means here, and it takes either of two shapes:
 *
 *  - a member holding nothing but `@everyone` cannot read it: the channel is
 *    hidden, or it shows only what arrives while you watch (Read Message
 *    History denied), and it is the backlog that an import copies;
 *  - some role or member overwrite denies View Channels or Read Message
 *    History: `@everyone` can read #brothers but `Pledge` cannot. Frapp has no
 *    deny, so importing it chapter-wide shows it to exactly the members Discord
 *    hid it from. An allow only widens the audience, so it never counts.
 *
 * A deny on a role nobody holds still counts. The cost is one extra question
 * to the admin, where the other mistake publishes a channel.
 */
export function openToEveryone(
  guildId: string,
  roles: readonly DiscordRolePermissions[],
  overwrites: readonly DiscordPermissionOverwrite[],
): boolean {
  const nobody: DiscordPermissionSubject = { userId: null, roleIds: [] };
  const base = basePermissions(guildId, roles, nobody);
  if (!canReadHistory(channelPermissions(base, guildId, overwrites, nobody))) {
    return false;
  }
  const hiding = VIEW_CHANNEL | READ_MESSAGE_HISTORY;
  return !overwrites.some(
    (overwrite) =>
      !(overwrite.type === 0 && overwrite.id === guildId) &&
      (bits(overwrite.deny) & hiding) !== 0n,
  );
}

/**
 * The roles that could read a channel's history in Discord, each asked on its
 * own: a member holding `@everyone` and that one role. This is what "Same as
 * Discord" gates an imported channel on (#2818).
 *
 * Worked from the overwrites, never from what the bot can read: a role the bot
 * does not hold, and cannot see through, still appears in the overwrites of a
 * channel it gates. `candidates` is the set worth asking about (the caller
 * drops `@everyone` and the managed roles Discord creates for bots and
 * boosters), in the order to report them.
 *
 * Empty when `@everyone` alone could read it: the channel is private only
 * because a deny hides it from someone (the "hide it from pledges" shape).
 * Every other role then reads it by inheriting from `@everyone`, colour and
 * game roles included, so none of them is an audience worth copying, and
 * Frapp has no deny to express the rest. Such a channel needs a choice.
 *
 * One role at a time is an approximation, because Discord answers per
 * combination of roles and Frapp's gate is "any of" with no deny. It differs
 * in two places, both rare in a chapter server: two roles that read only
 * together (neither alone) are not listed, which is narrower than Discord; and
 * a member holding a listed role plus a role the channel denies reads it in
 * Frapp but not in Discord, unless the listed role's read came from an
 * overwrite allow, which beats the deny there too.
 */
export function readerRoleIds(
  guildId: string,
  roles: readonly DiscordRolePermissions[],
  overwrites: readonly DiscordPermissionOverwrite[],
  candidates: readonly string[],
): string[] {
  const readsAs = (subject: DiscordPermissionSubject) =>
    canReadHistory(
      channelPermissions(
        basePermissions(guildId, roles, subject),
        guildId,
        overwrites,
        subject,
      ),
    );
  if (readsAs({ userId: null, roleIds: [] })) return [];
  return candidates.filter(
    (roleId) =>
      roleId !== guildId && readsAs({ userId: null, roleIds: [roleId] }),
  );
}

/**
 * Whether the channel is read-only in Discord: the people who read it cannot
 * talk in it (#3697). This is what makes an imported channel read-only in
 * Frapp, where only an `announcements:post` holder can post in one; every
 * other imported channel is postable by whoever can read it.
 *
 * The readers are `@everyone`, when it can read the channel's history, and
 * each of `candidates` on its own that can. Two kinds are set aside:
 *
 *  - a role holding Administrator, which every overwrite passes over, so
 *    whether it can talk says nothing about the channel;
 *  - a role the channel itself allows to talk (an overwrite allow on that
 *    role): the exec of an `#announcements`, which Frapp has no per-channel
 *    way to express. They are why a read-only channel needs its posters to
 *    hold `announcements:post`, which only the President does by default.
 *
 * The channel is read-only when none of the remaining readers can talk in it,
 * and it is the channel that stopped them: it took talking away from one of
 * them that the server otherwise lets talk, or nobody reading it can talk at
 * all. So `#announcements` denying `@everyone` is read-only, and so is one
 * denying "Brothers" when they can talk only by inheriting from `@everyone`.
 * A channel where the brothers talk and the pledges are denied stays
 * postable (Frapp has no deny; the pledges can post there), and so does
 * every channel of a server whose "Muted" role is denied everywhere. A server
 * that lets nobody talk by default and allows members per channel reads its
 * per-channel allows as privileged only where nobody else can talk, so its
 * discussion channels stay postable, and an `#announcements` there that
 * allows exec is postable too (the one shape this misses).
 *
 * Talking is Send Messages, except in a forum (`isForum`), where that is
 * Create Posts and members talk by replying, Send Messages in Threads. One role
 * at a time approximates Discord, which answers per combination of roles; the
 * wizard shows the answer per channel and lets the admin change it.
 */
export function readOnlyInDiscord(
  guildId: string,
  roles: readonly DiscordRolePermissions[],
  overwrites: readonly DiscordPermissionOverwrite[],
  candidates: readonly string[],
  isForum = false,
): boolean {
  const talk = isForum ? SEND_MESSAGES_IN_THREADS : SEND_MESSAGES;
  const allowedHere = new Set(
    overwrites
      .filter(
        (overwrite) =>
          overwrite.type === 0 &&
          overwrite.id !== guildId &&
          (bits(overwrite.allow) & talk) !== 0n,
      )
      .map((overwrite) => overwrite.id),
  );
  const readers: {
    canTalk: boolean;
    silenced: boolean;
    privileged: boolean;
  }[] = [];
  const ask = (subject: DiscordPermissionSubject, privileged: boolean) => {
    const base = basePermissions(guildId, roles, subject);
    if (base === ALL) return; // Administrator: overwrites do not apply.
    const here = channelPermissions(base, guildId, overwrites, subject);
    if (!canReadHistory(here)) return;
    const canTalk = (here & talk) !== 0n;
    readers.push({
      canTalk,
      silenced: !canTalk && (base & talk) !== 0n,
      privileged,
    });
  };
  ask({ userId: null, roleIds: [] }, false);
  for (const roleId of candidates) {
    if (roleId === guildId) continue;
    ask({ userId: null, roleIds: [roleId] }, allowedHere.has(roleId));
  }
  const common = readers.filter((reader) => !reader.privileged);
  if (common.length === 0 || common.some((reader) => reader.canTalk)) {
    return false;
  }
  return (
    readers.some((reader) => reader.silenced) ||
    !readers.some((reader) => reader.canTalk)
  );
}

/** Parse `permission_overwrites` off a raw channel, dropping malformed rows. */
export function parseOverwrites(raw: unknown): DiscordPermissionOverwrite[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscordPermissionOverwrite[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const type = record.type;
    if (typeof id !== 'string' || (type !== 0 && type !== 1)) continue;
    out.push({
      id,
      type,
      allow: typeof record.allow === 'string' ? record.allow : '0',
      deny: typeof record.deny === 'string' ? record.deny : '0',
    });
  }
  return out;
}
