import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ROLE_NAME_MAX_LENGTH } from '@repo/validation';
import {
  DISCORD_IMPORT_REPOSITORY,
  type IDiscordImportRepository,
} from '#domain/repositories/discord-import.repository.interface';
import {
  CHAT_CHANNEL_REPOSITORY,
  type IChatChannelRepository,
} from '#domain/repositories/chat.repository.interface';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordRoleMapping,
  DiscordRoleMappingAction,
} from '#domain/entities/discord-import.entity';
import type { Role } from '#domain/entities/role.entity';
import {
  DISCORD_READ_PERMISSION_PREFIX,
  parseRoleMapping,
  roleNameKey,
  sameAsDiscordGate,
  uniqueReadPermission,
} from '#domain/utils/discord-role-gates';
import { RbacService } from './rbac.service';
import { assertImportMutable, loadImport } from './discord-import-guards';

/**
 * One Discord role's answer on the role step, as the caller sends it. The
 * read permission is never taken from the caller: the API assigns it.
 */
export interface RoleMappingInput {
  discord_role_id: string;
  discord_role_name: string;
  action: DiscordRoleMappingAction;
  /** `existing` only: one of this chapter's roles. */
  frapp_role_id?: string | null;
  /** `new` only: the name to create the role with. */
  new_role_name?: string | null;
}

/** Whether two gates hold the same permissions, in any order. */
function sameGate(a: readonly string[], b: readonly string[] | null): boolean {
  const right = new Set(b ?? []);
  return a.length === right.size && a.every((entry) => right.has(entry));
}

/**
 * The role step of the Discord archive importer (#2818, split out in #3271):
 * which Frapp role each Discord role becomes, and, when the import starts,
 * creating those roles and granting the read permissions its "Same as
 * Discord" channels are gated on.
 *
 * `DiscordImportService.start` calls `provisionRoles` after its own checks
 * pass; nothing else here runs on its own schedule.
 */
@Injectable()
export class DiscordImportRoleMappingService {
  constructor(
    @Inject(DISCORD_IMPORT_REPOSITORY)
    private readonly importRepo: IDiscordImportRepository,
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Record which Frapp role each Discord role becomes (#2818).
   *
   * The mapping gates channels and creates roles, but never assigns anyone:
   * the importer does not touch a `members` row, since every imported author
   * is a name on a message, not an account. Nothing is created or granted
   * here. Starting the import does that (`provisionRoles`), for the channels
   * that end up gated on it.
   *
   * Saving it assigns each mapped Frapp role its read permission, so the
   * channel step can resolve a "Same as Discord" gate before any new role
   * exists. Mapping anything needs `roles:manage` as well as the import's own
   * `channels:manage`, because starting the import creates roles and grants
   * permissions that Settings → Roles would otherwise require it for. An
   * all-Ignore mapping needs nothing more.
   */
  async setRoleMapping(
    id: string,
    chapterId: string,
    entries: RoleMappingInput[],
    canManageRoles: boolean,
  ): Promise<DiscordImport> {
    const job = await loadImport(this.importRepo, id, chapterId);
    assertImportMutable(job);

    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.discord_role_id)) {
        throw new BadRequestException(
          `The Discord role ${entry.discord_role_name} is mapped twice.`,
        );
      }
      seen.add(entry.discord_role_id);
    }

    const mapsSomething = entries.some((entry) => entry.action !== 'ignore');
    if (mapsSomething && !canManageRoles) {
      throw new ForbiddenException(
        'Mapping Discord roles to Frapp roles creates roles and lets them read the imported channels, which needs permission to manage roles. Set every role to Ignore, or ask someone who can manage roles to map them.',
      );
    }

    let roles: Role[] = [];
    const reserved = new Set<string>();
    if (mapsSomething) {
      // A string no role holds may still be spoken for: a channel gated on
      // it (its role deleted since), or another import's saved mapping that
      // has not started yet. Either would open that channel, or that
      // import's channels, to the role this mapping names (#2818).
      const [chapterRoles, gates, imports] = await Promise.all([
        this.rbac.findByChapter(chapterId),
        this.channelRepo.findRoleGates(chapterId),
        this.importRepo.findByChapter(chapterId),
      ]);
      roles = chapterRoles;
      for (const gate of gates) {
        for (const permission of gate.required_permissions) {
          reserved.add(permission);
        }
      }
      for (const other of imports) {
        if (other.id === id) continue;
        for (const entry of parseRoleMapping(other.role_mapping)) {
          if (entry.read_permission) reserved.add(entry.read_permission);
        }
      }
    }
    const mapping = this.resolveRoleMapping(
      entries,
      roles,
      parseRoleMapping(job.role_mapping),
      reserved,
    );
    return this.importRepo.update(id, chapterId, { role_mapping: mapping });
  }

  /**
   * Validate the role step's answers against the chapter's roles, and give
   * each mapped Frapp role its read permission.
   *
   * A read permission is held by one role alone, or it would gate a channel
   * to a second role nobody chose. So an existing role reuses a
   * `channels:read:` permission only it already holds (from an earlier import),
   * and otherwise gets a new string that no role holds and nothing in
   * `reserved` (a channel gate, another import's mapping) names. Every entry
   * mapping to the same role shares one, including two Discord roles mapped
   * to the same new role name. `provisionRoles` checks it all again at start.
   */
  private resolveRoleMapping(
    entries: readonly RoleMappingInput[],
    roles: readonly Role[],
    previous: readonly DiscordRoleMapping[],
    reserved: ReadonlySet<string>,
  ): DiscordRoleMapping[] {
    const byId = new Map(roles.map((role) => [role.id, role]));
    const byName = new Map(roles.map((role) => [roleNameKey(role.name), role]));
    const previousById = new Map(
      previous.map((entry) => [entry.discord_role_id, entry]),
    );

    const holders = new Map<string, number>();
    for (const role of roles) {
      for (const permission of role.permissions) {
        holders.set(permission, (holders.get(permission) ?? 0) + 1);
      }
    }
    const taken = new Set([...holders.keys(), ...reserved]);
    const assigned = new Map<string, string>();
    const permissionFor = (target: string, name: string, role?: Role) => {
      const known = assigned.get(target);
      if (known) return known;
      const permission =
        role?.permissions.find(
          (held) =>
            held.startsWith(DISCORD_READ_PERMISSION_PREFIX) &&
            holders.get(held) === 1,
        ) ?? uniqueReadPermission(name, taken);
      taken.add(permission);
      assigned.set(target, permission);
      return permission;
    };

    return entries.map((entry): DiscordRoleMapping => {
      const base = {
        discord_role_id: entry.discord_role_id,
        discord_role_name: entry.discord_role_name,
      };
      if (entry.action === 'existing') {
        const role = entry.frapp_role_id
          ? byId.get(entry.frapp_role_id)
          : undefined;
        if (!role) {
          throw new BadRequestException(
            `The role chosen for ${entry.discord_role_name} is not one of this chapter's roles.`,
          );
        }
        return {
          ...base,
          action: 'existing',
          frapp_role_id: role.id,
          new_role_name: null,
          read_permission: permissionFor(`role:${role.id}`, role.name, role),
        };
      }
      if (entry.action === 'new') {
        const name = entry.new_role_name?.trim() ?? '';
        if (!name) {
          throw new BadRequestException(
            `Name the new role for ${entry.discord_role_name}.`,
          );
        }
        if (name.length > ROLE_NAME_MAX_LENGTH) {
          throw new BadRequestException(
            `The new role for ${entry.discord_role_name} needs a name of at most ${ROLE_NAME_MAX_LENGTH} characters.`,
          );
        }
        const clash = byName.get(roleNameKey(name));
        if (clash) {
          // The role an earlier start of THIS import created is not a clash:
          // re-saving the mapping of a failed import keeps pointing at it.
          const before = previousById.get(entry.discord_role_id);
          if (before?.action === 'new' && before.frapp_role_id === clash.id) {
            return {
              ...base,
              action: 'new',
              frapp_role_id: clash.id,
              new_role_name: clash.name,
              read_permission: permissionFor(
                `role:${clash.id}`,
                clash.name,
                clash,
              ),
            };
          }
          throw new BadRequestException(
            `A role named "${clash.name}" already exists. Map ${entry.discord_role_name} to it instead of creating a new one.`,
          );
        }
        return {
          ...base,
          action: 'new',
          frapp_role_id: null,
          new_role_name: name,
          read_permission: permissionFor(`new:${roleNameKey(name)}`, name),
        };
      }
      return {
        ...base,
        action: 'ignore',
        frapp_role_id: null,
        new_role_name: null,
        read_permission: null,
      };
    });
  }

  /**
   * Create the mapping's new roles and grant each role the read permission
   * of the channels about to be created on it (#2818). Never assigns anyone.
   *
   * Only a channel still to be created counts: one whose Frapp channel exists
   * already has its gate. Each such "Same as Discord" channel is checked
   * against the mapping as it stands now, because the role step can be saved
   * again after the channels were mapped, and a gate that no longer matches
   * would be created on permissions nobody is granted.
   *
   * Everything is checked before anything is written:
   *
   *  - a read permission stays with the roles the mapping gives it to. One
   *    held by any other role, or newly granted while it already gates a
   *    channel this import did not create, would open that channel to roles
   *    nobody chose, so the start is refused and the roles are saved again,
   *    which picks a fresh string;
   *  - creating a role or granting a permission needs `roles:manage` from
   *    whoever starts the import, not only from whoever saved the mapping,
   *    as Settings → Roles would require.
   *
   * A new role is created with only the read permissions that gate an
   * imported channel, and nothing else (owner's decision on #2818). Its id is
   * recorded on the import as soon as it exists, so a start that fails part
   * way leaves a mapping that points at it, and re-running skips it. The
   * exception is a failure of that recording write itself: the role exists
   * with no id on the import, and the retry refuses it as a clash (#2986).
   * A role someone else added under a new role's name since is refused, not
   * adopted, and a permission a role already holds is not added twice.
   *
   * Both writes go through `RbacService`, so each role created and each
   * permission granted writes its `chapter_audit_log` row as `userId`, the
   * member who started the import, as the same change made on Settings →
   * Roles would (#2599). A start that fails on one of those audit writes has
   * already made the change, and the retry skips it like any other finished
   * step, so that role or grant stays unaudited (#1599).
   */
  async provisionRoles(
    importId: string,
    chapterId: string,
    userId: string,
    channels: readonly DiscordImportChannel[],
    mapping: DiscordRoleMapping[],
    canManageRoles: boolean,
  ): Promise<DiscordRoleMapping[]> {
    const needed = new Set<string>();
    for (const channel of channels) {
      if (
        channel.parent_discord_channel_id ||
        channel.mapping_action !== 'create_new' ||
        channel.target_channel_id !== null ||
        channel.status === 'completed' ||
        !channel.new_channel_same_as_discord
      ) {
        continue;
      }
      const gate = sameAsDiscordGate(
        channel.discord_reader_role_ids ?? [],
        mapping,
      );
      if (
        gate.length === 0 ||
        !sameGate(gate, channel.new_channel_required_permissions)
      ) {
        throw new BadRequestException(
          `The role mapping changed after #${channel.discord_channel_name} was mapped. Save the channel mapping again, then start the import.`,
        );
      }
      for (const permission of gate) needed.add(permission);
    }

    const creating = mapping.filter(
      (entry) => entry.action === 'new' && entry.frapp_role_id === null,
    );
    const granting = mapping.some(
      (entry) => entry.read_permission && needed.has(entry.read_permission),
    );
    if (creating.length === 0 && !granting) return mapping;

    const roles = await this.rbac.findByChapter(chapterId);
    const byId = new Map(roles.map((role) => [role.id, role]));
    const byName = new Map(roles.map((role) => [roleNameKey(role.name), role]));

    // A role named like a new one, and not recorded as this import's, was
    // made by someone else since the mapping was saved. It is not adopted:
    // saving would have refused the clash, and adopting it here would give
    // its members the imported channels without anyone choosing that.
    const provisioned = mapping.map((entry) => ({ ...entry }));
    for (const entry of provisioned) {
      if (entry.action !== 'new' || entry.frapp_role_id !== null) continue;
      const name = entry.new_role_name ?? entry.discord_role_name;
      const existing = byName.get(roleNameKey(name));
      if (existing) {
        throw new BadRequestException(
          `A role named "${existing.name}" was added since the roles were mapped. Map ${entry.discord_role_name} to it, or give the new role another name, then start the import.`,
        );
      }
    }

    // The plan: roles to create, grants to add, and who may hold each
    // permission once it is done.
    const toCreate = new Map<string, { name: string; permissions: string[] }>();
    const grants: { roleId: string; permission: string }[] = [];
    const holdersAllowed = new Map<string, Set<string>>();
    for (const entry of provisioned) {
      const permission = entry.read_permission;
      if (!permission || entry.action === 'ignore') continue;
      if (entry.frapp_role_id === null) {
        const name = entry.new_role_name ?? entry.discord_role_name;
        toCreate.set(roleNameKey(name), {
          name,
          permissions: needed.has(permission) ? [permission] : [],
        });
        continue;
      }
      const allowed = holdersAllowed.get(permission) ?? new Set<string>();
      allowed.add(entry.frapp_role_id);
      holdersAllowed.set(permission, allowed);
      if (!needed.has(permission)) continue;
      const role = byId.get(entry.frapp_role_id);
      if (!role) {
        throw new BadRequestException(
          `The Frapp role ${entry.discord_role_name} maps to no longer exists. Map the roles again, then start the import.`,
        );
      }
      if (
        !role.permissions.includes(permission) &&
        !grants.some(
          (grant) =>
            grant.roleId === role.id && grant.permission === permission,
        )
      ) {
        grants.push({ roleId: role.id, permission });
      }
    }

    const newlyGranted = new Set([
      ...grants.map((grant) => grant.permission),
      ...[...toCreate.values()].flatMap((plan) => plan.permissions),
    ]);
    const refuse = (permission: string) =>
      new BadRequestException(
        `The read permission ${permission} is already in use elsewhere in this chapter. Save the roles and the channels again so Frapp can pick a new one, then start the import.`,
      );
    for (const role of roles) {
      for (const permission of role.permissions) {
        if (
          needed.has(permission) &&
          !holdersAllowed.get(permission)?.has(role.id)
        ) {
          throw refuse(permission);
        }
      }
    }
    if (newlyGranted.size > 0) {
      // Only channels this import created, never a merge target: a
      // `use_existing` channel was there before and keeps its own gate.
      const own = new Set(
        channels.flatMap((channel) =>
          channel.mapping_action === 'create_new' && channel.target_channel_id
            ? [channel.target_channel_id]
            : [],
        ),
      );
      for (const gate of await this.channelRepo.findRoleGates(chapterId)) {
        if (own.has(gate.id)) continue;
        const clash = gate.required_permissions.find((permission) =>
          newlyGranted.has(permission),
        );
        if (clash) throw refuse(clash);
      }
    }

    if ((toCreate.size > 0 || grants.length > 0) && !canManageRoles) {
      throw new ForbiddenException(
        'Starting this import creates roles or lets roles read the imported channels, which needs permission to manage roles. Ask someone who can manage roles to start it, or set every role to Ignore.',
      );
    }

    let order = Math.max(0, ...roles.map((role) => role.display_order));
    for (const [key, plan] of toCreate) {
      order += 1;
      // The id is recorded before the role's audit row is written, not after
      // `create` returns: that write can fail once the role exists, and a
      // mapping without the id would make the retry refuse this very role.
      await this.rbac.create(
        chapterId,
        userId,
        {
          name: plan.name,
          permissions: plan.permissions,
          display_order: order,
          color: null,
        },
        async (role) => {
          for (const entry of provisioned) {
            if (
              entry.action === 'new' &&
              entry.frapp_role_id === null &&
              roleNameKey(entry.new_role_name ?? entry.discord_role_name) ===
                key
            ) {
              entry.frapp_role_id = role.id;
            }
          }
          await this.importRepo.update(importId, chapterId, {
            role_mapping: provisioned,
          });
        },
      );
    }

    for (const grant of grants) {
      const role = byId.get(grant.roleId);
      if (!role || role.permissions.includes(grant.permission)) continue;
      byId.set(
        role.id,
        await this.rbac.update(role.id, chapterId, userId, {
          permissions: [...role.permissions, grant.permission],
        }),
      );
    }
    return provisioned;
  }
}
