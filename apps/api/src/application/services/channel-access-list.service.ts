import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CHANNEL_ACCESS_LIST_MAX,
  channelAccessEntry,
  normalizeChannelAccessList,
  parseChannelAccessEntry,
} from '@repo/validation';
import { SystemRoleKeys } from '#domain/constants/permissions';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { CHAT_CATEGORY_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import type { IChatCategoryRepository } from '#domain/repositories/chat.repository.interface';
import type { ChannelType, ChatChannel } from '#domain/entities/chat.entity';

/** One thing a who-can-see or who-can-post list can name, as the editor offers it. */
export interface ChannelAccessOption {
  /** The entry as stored: `tier:<id>` or `role:<id>`. */
  entry: string;
  kind: 'tier' | 'role';
  id: string;
  name: string;
  /** A role's color; `null` for a tier and an uncolored role. */
  color: string | null;
  /** For a role, its tier (`null` outside the tiers); always `null` for a tier. */
  tier_id: string | null;
  /** The `users.id` of every member it names, so the editor can count who a list reaches. */
  user_ids: string[];
  /**
   * The Everyone role (#4191): not offered to add, since it names only the
   * members whose rows hold it, not everyone; a list that already names it
   * still shows it. `false` for every other option.
   */
  hidden: boolean;
}

/** Both lists, as a write sends them: `undefined` leaves one alone, `null` is everyone. */
export interface ChannelAccessListsInput {
  who_can_see?: string[] | null;
  who_can_post?: string[] | null;
}

/**
 * The columns a channel's access is written as: the lists, and the two old
 * columns kept equal to them (migration 20261111233000 checks both).
 */
export type ChannelAccessColumns = Pick<
  ChatChannel,
  'type' | 'who_can_see' | 'who_can_post' | 'is_read_only'
>;

/** A channel or category's lists as one write stores them, old columns included. */
export function channelAccessColumns(
  whoCanSee: string[] | null,
  whoCanPost: string[] | null,
): ChannelAccessColumns {
  return {
    type: whoCanSee === null ? 'PUBLIC' : 'ROLE_GATED',
    who_can_see: whoCanSee,
    who_can_post: whoCanPost,
    is_read_only: whoCanPost !== null,
  };
}

const LISTED_TYPES: ReadonlySet<ChannelType> = new Set([
  'PUBLIC',
  'ROLE_GATED',
]);

/**
 * What a channel's and a category's who-can-see and who-can-post lists can
 * hold (#3722), and the check every write of one goes through.
 *
 * The options are tiers first (highest first), then roles in the chapter's
 * role order: the two kinds the lists take today. Groups (#4076) add their
 * own kind here and in `CHANNEL_ACCESS_ENTRY_KINDS`; the editor groups by
 * `kind`, so it needs no change to show them.
 */
@Injectable()
export class ChannelAccessListService {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(ROLE_TIER_REPOSITORY)
    private readonly tierRepo: IRoleTierRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(CHAT_CATEGORY_REPOSITORY)
    private readonly categoryRepo: IChatCategoryRepository,
  ) {}

  /**
   * The access a new channel is written with. A PRIVATE channel is its
   * members' (`member_ids`) and takes no lists. Any other channel takes the
   * lists sent, and copies its category's for a list left out (a channel
   * starts out matching its category); with no category, a list left out is
   * everyone. `type` follows who can see: ROLE_GATED is accepted for clients
   * that still send it, and then needs a who-can-see list.
   */
  async forNewChannel(
    chapterId: string,
    type: ChannelType,
    categoryId: string | null,
    input: ChannelAccessListsInput,
  ): Promise<ChannelAccessColumns> {
    if (!LISTED_TYPES.has(type)) {
      if (input.who_can_see != null || input.who_can_post != null) {
        throw new BadRequestException(
          "A private channel's members decide who reads it, so it takes no who-can-see or who-can-post list",
        );
      }
      return {
        type,
        who_can_see: null,
        who_can_post: null,
        is_read_only: false,
      };
    }
    const lists = await this.normalize(chapterId, input);
    let whoCanSee = lists.who_can_see;
    let whoCanPost = lists.who_can_post;
    if ((whoCanSee === undefined || whoCanPost === undefined) && categoryId) {
      const category = await this.categoryRepo.findById(categoryId, chapterId);
      if (whoCanSee === undefined) whoCanSee = category?.who_can_see ?? null;
      if (whoCanPost === undefined) whoCanPost = category?.who_can_post ?? null;
    }
    whoCanSee ??= null;
    whoCanPost ??= null;
    if (type === 'ROLE_GATED' && whoCanSee === null) {
      throw new BadRequestException(
        'A ROLE_GATED channel needs a who_can_see list',
      );
    }
    return channelAccessColumns(whoCanSee, whoCanPost);
  }

  /**
   * The access columns an update writes, or `{}` when it touches neither list.
   * `matchCategory` copies the lists of the category the channel ends up in
   * (after a `category_id` change in the same update). Refused on a private
   * channel or DM, which `member_ids` decides, and on the audit log, which
   * everyone reads and only Frapp writes in (#3909).
   */
  async forChannelUpdate(
    chapterId: string,
    existing: ChatChannel,
    input: ChannelAccessListsInput & {
      match_category_access?: boolean;
      category_id?: string | null;
    },
  ): Promise<Partial<ChannelAccessColumns>> {
    const sendsLists =
      input.who_can_see !== undefined || input.who_can_post !== undefined;
    const matches = input.match_category_access === true;
    if (!sendsLists && !matches) return {};

    if (!LISTED_TYPES.has(existing.type)) {
      // A private channel made read-only before #3722 keeps the roles that
      // could post as a who-can-post list (migration 20261111233000). It can
      // be cleared, so everyone in it posts, but never set.
      if (
        existing.type === 'PRIVATE' &&
        !matches &&
        input.who_can_see === undefined &&
        input.who_can_post === null
      ) {
        return { who_can_post: null, is_read_only: false };
      }
      throw new BadRequestException(
        "A private channel's members decide who reads it, so it takes no who-can-see or who-can-post list",
      );
    }
    if (existing.is_audit_log) {
      throw new BadRequestException(
        'Everyone sees the audit log channel and only Frapp posts in it',
      );
    }
    if (sendsLists && matches) {
      throw new BadRequestException(
        'Send the lists or match the category, not both',
      );
    }

    if (matches) {
      const categoryId =
        input.category_id !== undefined
          ? input.category_id
          : existing.category_id;
      if (!categoryId) {
        throw new BadRequestException("This channel isn't in a category");
      }
      const category = await this.categoryRepo.findById(categoryId, chapterId);
      if (!category) throw new NotFoundException('Category not found');
      return channelAccessColumns(
        category.who_can_see ?? null,
        category.who_can_post ?? null,
      );
    }

    const lists = await this.normalize(chapterId, input);
    return channelAccessColumns(
      lists.who_can_see !== undefined
        ? lists.who_can_see
        : (existing.who_can_see ?? null),
      lists.who_can_post !== undefined
        ? lists.who_can_post
        : (existing.who_can_post ?? null),
    );
  }

  async listOptions(chapterId: string): Promise<ChannelAccessOption[]> {
    const [tiers, roles, members] = await Promise.all([
      this.tierRepo.findByChapter(chapterId),
      this.roleRepo.findByChapter(chapterId),
      this.memberRepo.findByChapter(chapterId),
    ]);
    const chapterRoles = roles.filter((role) => role.chapter_id === chapterId);
    const tierOfRole = new Map(
      chapterRoles.map((role) => [role.id, role.tier_id] as const),
    );

    // Who holds each role, and so each tier. `role_ids` is not foreign-keyed
    // and may hold uppercase or foreign ids: only ids naming a role of this
    // chapter count, compared lowercased as the database compares uuids.
    const holdersOf = new Map<string, Set<string>>();
    const hold = (entry: string, userId: string) => {
      const set = holdersOf.get(entry) ?? new Set<string>();
      set.add(userId);
      holdersOf.set(entry, set);
    };
    for (const member of members) {
      if (member.chapter_id !== chapterId) continue;
      for (const raw of member.role_ids ?? []) {
        const roleId = raw.toLowerCase();
        if (!tierOfRole.has(roleId)) continue;
        hold(channelAccessEntry('role', roleId), member.user_id);
        const tierId = tierOfRole.get(roleId);
        if (tierId) hold(channelAccessEntry('tier', tierId), member.user_id);
      }
    }
    const usersOf = (entry: string) => [...(holdersOf.get(entry) ?? [])].sort();

    const tierOptions: ChannelAccessOption[] = [...tiers]
      .filter((tier) => tier.chapter_id === chapterId)
      .sort((a, b) => a.position - b.position)
      .map((tier) => {
        const entry = channelAccessEntry('tier', tier.id);
        return {
          entry,
          kind: 'tier',
          id: tier.id,
          name: tier.name,
          color: null,
          tier_id: null,
          user_ids: usersOf(entry),
          hidden: false,
        };
      });
    const roleOptions: ChannelAccessOption[] = [...chapterRoles]
      .sort(
        (a, b) =>
          a.display_order - b.display_order || a.name.localeCompare(b.name),
      )
      .map((role) => {
        const entry = channelAccessEntry('role', role.id);
        return {
          entry,
          kind: 'role',
          id: role.id,
          name: role.name,
          color: role.color ?? null,
          tier_id: role.tier_id ?? null,
          user_ids: usersOf(entry),
          hidden: role.system_key === SystemRoleKeys.MEMBER,
        };
      });
    return [...tierOptions, ...roleOptions];
  }

  /**
   * Check the lists a write sends and return them as stored: sorted, without
   * repeats, every entry naming a tier or role of this chapter. `undefined`
   * stays `undefined` (leave it alone) and `null` stays `null` (everyone).
   *
   * An empty list is refused: it would admit nobody but `*`, which is never
   * what an officer means by picking nobody. A list can still end up empty
   * when the last role or tier on it is deleted; it then admits only `*`
   * until an officer picks again.
   */
  async normalize(
    chapterId: string,
    input: ChannelAccessListsInput,
  ): Promise<ChannelAccessListsInput> {
    const lists = {
      who_can_see: input.who_can_see,
      who_can_post: input.who_can_post,
    };
    const entries: string[] = [];
    for (const [field, list] of Object.entries(lists)) {
      if (list == null) continue;
      if (list.length === 0) {
        throw new BadRequestException(
          field === 'who_can_see'
            ? 'Pick at least one tier or role who can see it, or choose everyone'
            : 'Pick at least one tier or role who can post, or choose everyone who can see it',
        );
      }
      if (list.length > CHANNEL_ACCESS_LIST_MAX) {
        throw new BadRequestException(
          `A list can name at most ${CHANNEL_ACCESS_LIST_MAX} tiers and roles`,
        );
      }
      entries.push(...list);
    }

    if (entries.length > 0) {
      const parsed = entries.map((entry) => {
        const value = parseChannelAccessEntry(entry.toLowerCase());
        if (!value) {
          throw new BadRequestException(`Not a tier or role: ${entry}`);
        }
        return value;
      });
      const [tiers, roles] = await Promise.all([
        parsed.some((entry) => entry.kind === 'tier')
          ? this.tierRepo.findByChapter(chapterId)
          : Promise.resolve([]),
        parsed.some((entry) => entry.kind === 'role')
          ? this.roleRepo.findByChapter(chapterId)
          : Promise.resolve([]),
      ]);
      const known = new Set([
        ...tiers
          .filter((tier) => tier.chapter_id === chapterId)
          .map((tier) => channelAccessEntry('tier', tier.id)),
        ...roles
          .filter((role) => role.chapter_id === chapterId)
          .map((role) => channelAccessEntry('role', role.id)),
      ]);
      for (const { kind, id } of parsed) {
        if (!known.has(channelAccessEntry(kind, id))) {
          throw new BadRequestException(
            `That ${kind} isn't in this chapter anymore. Reload and pick again.`,
          );
        }
      }
    }

    return {
      ...(lists.who_can_see !== undefined
        ? { who_can_see: normalizeChannelAccessList(lists.who_can_see) }
        : {}),
      ...(lists.who_can_post !== undefined
        ? { who_can_post: normalizeChannelAccessList(lists.who_can_post) }
        : {}),
    };
  }
}
