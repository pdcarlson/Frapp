import { SystemRoleKeys } from '#domain/constants/permissions';
import type { Role } from '#domain/entities/role.entity';
import type { ChapterGroupView } from '../../../chapter-group.service';
import type { MemberProfile } from '../../../member.service';
import { nameInLine } from '../../ask-lines';

/**
 * What a people tool says about one member (#4901): their roles, the groups
 * they are in, their class and their year. A profile also carries an email,
 * a phone number, a city and an employer; none of those is read here, so
 * none can reach a model (`spec/behavior/ai.md` § Live structured data).
 */

/** The fields of a profile the people tools read. Nothing else is touched. */
export type ProfileForAsk = Pick<
  MemberProfile,
  | 'user_id'
  | 'display_name'
  | 'role_ids'
  | 'custom_role_ids'
  | 'graduation_year'
  | 'is_alumni'
>;

/**
 * Role names by id, without the Everyone role: every member holds it
 * (#4191), so naming it says nothing and fills every line. A role's name is
 * text an officer typed, and it sits in a comma-separated list after a
 * member's name, so it is written the way a member's name is: with nothing
 * in it that could read as a second role or another line.
 */
export function roleNames(roles: readonly Role[]): Map<string, string> {
  return new Map(
    roles
      .filter((role) => role.system_key !== SystemRoleKeys.EVERYONE)
      .map((role) => [role.id, nameInLine(role.name)]),
  );
}

export function rolesHeld(
  profile: Pick<ProfileForAsk, 'role_ids' | 'custom_role_ids'>,
  names: ReadonlyMap<string, string>,
): string[] {
  return [...new Set([...profile.role_ids, ...(profile.custom_role_ids ?? [])])]
    .map((id) => names.get(id))
    .filter((name): name is string => Boolean(name));
}

const GROUP_KIND_WORDS: Record<ChapterGroupView['kind'], string> = {
  manual: 'group',
  pledge_class: 'class',
  class_year: 'class year',
  // Never shown: `askableGroups` keeps majors away from the model.
  major: 'major',
};

/**
 * The groups Ask may name to the model: every kind but a major's (#5778). A
 * member's major is a profile field Ask has never sent (`ProfileForAsk`
 * leaves it out), and the AI consent sheet and Privacy Policy don't list it,
 * so a major's group, which would say who has which major, stays out too.
 */
export function askableGroups<T extends Pick<ChapterGroupView, 'kind'>>(
  groups: readonly T[],
): T[] {
  return groups.filter((group) => group.kind !== 'major');
}

/** "Fall 2024 (class)": a group's name with what kind of group it is. */
export function groupLabel(group: ChapterGroupView): string {
  return `${nameInLine(group.name)} (${GROUP_KIND_WORDS[group.kind]})`;
}

/** The groups each member is in, by user id. */
export function groupsByMember(
  groups: readonly ChapterGroupView[],
): Map<string, string[]> {
  const held = new Map<string, string[]>();
  for (const group of groups) {
    for (const userId of group.member_ids) {
      held.set(userId, [...(held.get(userId) ?? []), groupLabel(group)]);
    }
  }
  return held;
}
