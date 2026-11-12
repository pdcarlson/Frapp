import type {
  ChapterGroup,
  ChapterGroupMembership,
} from '../entities/chapter-group.entity';

export const CHAPTER_GROUP_REPOSITORY = 'CHAPTER_GROUP_REPOSITORY';

/** What a group write may change (the kind and source are fixed at creation). */
export type ChapterGroupChanges = Partial<
  Pick<ChapterGroup, 'name' | 'color' | 'mentionable'>
>;

export interface IChapterGroupRepository {
  /** Every group of the chapter, any kind, empty ones included. */
  findByChapter(chapterId: string): Promise<ChapterGroup[]>;
  findById(id: string, chapterId: string): Promise<ChapterGroup | null>;
  /**
   * A new manual group. `null` when the chapter already has a manual group of
   * that name (trimmed, any case: the unique index).
   */
  create(data: {
    chapter_id: string;
    name: string;
    color: string | null;
    mentionable: boolean;
  }): Promise<ChapterGroup | null>;
  /** `null` when the name is taken, as {@link create}; `undefined` when no such group. */
  update(
    id: string,
    chapterId: string,
    changes: ChapterGroupChanges,
  ): Promise<ChapterGroup | null | undefined>;
  /** Deleting a group takes its entry off every channel list (a trigger). */
  delete(id: string, chapterId: string): Promise<void>;
  /**
   * Who is in each group of the chapter, every kind
   * (`chapter_group_memberships`), read whole however many pages it takes.
   */
  findMemberships(chapterId: string): Promise<ChapterGroupMembership[]>;
  /** Who is in one group now, sorted. */
  findMemberIds(chapterId: string, groupId: string): Promise<string[]>;
  /**
   * The groups one member is in that can open a channel: every kind but a
   * class year (`groupKindOpensChannels`). For channel access only.
   */
  findGroupIdsForUser(chapterId: string, userId: string): Promise<string[]>;
  /** Whether any channel's or category's who-can-see or who-can-post names it. */
  isNamedOnChannelList(chapterId: string, groupId: string): Promise<boolean>;
  /**
   * A manual group's members set to exactly `userIds`, all or none
   * (`set_chapter_group_members`). Resolves to the members after, or to why
   * nothing was written: no manual group of that id in the chapter, or
   * someone listed who isn't a member of it.
   */
  setMembers(
    groupId: string,
    chapterId: string,
    userIds: string[],
  ): Promise<string[] | 'group_not_found' | 'member_not_found'>;
}
