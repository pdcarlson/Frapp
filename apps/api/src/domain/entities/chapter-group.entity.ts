/**
 * A group (`chapter_groups`, #4076): a named set of members that holds no
 * permissions and sits in no tier. It can be `@`-mentioned and named in a
 * channel's who-can-see and who-can-post lists (`group:<id>`).
 *
 * - `manual`: an officer named it and picks its members
 *   (`chapter_group_members`).
 * - `pledge_class`: one per pledge class; its members are the members in it.
 * - `class_year`: one per graduation year a member of the chapter has; its
 *   members are the members graduating that year.
 *
 * An automatic group's name follows its class's or year's, and its members
 * follow the members' own data; only its color and ping switch are the
 * chapter's to change. Migration `20261113040007_chapter_groups.sql`.
 */
export type ChapterGroupKind = 'manual' | 'pledge_class' | 'class_year';

export interface ChapterGroup {
  id: string;
  chapter_id: string;
  kind: ChapterGroupKind;
  name: string;
  color: string | null;
  /**
   * Whether any member may `@` the group. On by default; while off, only a
   * member who can manage channels or roles can ping it, as for a role.
   */
  mentionable: boolean;
  /** The class an automatic `pledge_class` group follows, else `null`. */
  pledge_class_id: string | null;
  /** The year an automatic `class_year` group follows, else `null`. */
  class_year: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * One member of one group, as `chapter_group_memberships` (a view) reads it
 * for every kind: the one definition the API and `can_read_chat_channel`
 * share.
 */
export interface ChapterGroupMembership {
  chapter_id: string;
  group_id: string;
  user_id: string;
  /** The group's kind, so a reader can tell a class year apart. */
  kind: ChapterGroupKind;
}

/**
 * Whether a group of this kind can open a channel that lists it. A class year
 * can't: members set their own graduation year, so it is for `@`-mentions
 * only (`can_read_chat_channel` holds the same rule).
 */
export function groupKindOpensChannels(kind: ChapterGroupKind): boolean {
  return kind !== 'class_year';
}

/** A manual group's hand-picked member (`chapter_group_members`). */
export interface ChapterGroupMember {
  group_id: string;
  chapter_id: string;
  user_id: string;
  created_at: string;
}
