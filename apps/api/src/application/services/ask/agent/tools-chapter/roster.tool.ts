import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { ChapterGroupService } from '../../../chapter-group.service';
import { MemberService } from '../../../member.service';
import { RbacService } from '../../../rbac.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  count,
  fitRows,
  found,
  listSourceId,
  liveSource,
  matchByName,
  nothing,
  People,
  wordsArg,
} from './chapter-tool-kit';
import { groupLabel, roleNames, rolesHeld } from './people';

/** A roster longer than this is cut, with a line saying so. */
const ROSTER_LIMIT = 250;

const input = z.object({
  role: wordsArg(
    'Only members who hold a role or office with this name, for example Treasurer or Social Chair. Empty for every role.',
  ),
  group: wordsArg(
    'Only members in a group, class or class year with this name, for example Fall 2024. Empty for every group.',
  ),
});
type Args = z.infer<typeof input>;

/**
 * Who is in the chapter, or who holds a role or is in a group: `GET
 * /v1/members` with `GET /v1/roles` and `GET /v1/groups`, the three reads
 * the directory page makes. Names and roles only.
 */
@Injectable()
export class RosterAgentTool implements AgentReadTool<Args> {
  readonly name = 'roster';
  readonly description =
    'Who is in the chapter and which roles and offices each member holds. Give a role to find who holds it (who is the treasurer, who is on a committee), or a group to list a class, a class year or a named group. With neither it lists every member. Never gives contact details.';
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = null;
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading the roster';

  constructor(
    private readonly members: MemberService,
    private readonly rbac: RbacService,
    private readonly groups: ChapterGroupService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const [profiles, roles, groups] = await Promise.all([
      this.members.findProfilesByChapter(context.chapterId),
      this.rbac.findByChapter(context.chapterId),
      args.group ? this.groups.list(context.chapterId) : Promise.resolve([]),
    ]);
    const names = roleNames(roles);

    let kept = profiles;
    const summary: string[] = [];
    if (args.role) {
      const wanted = matchByName([...names], ([, name]) => name, args.role);
      if (wanted.length === 0) {
        return nothing(
          context,
          'No role has that name. Call roster with no role to see every role members hold.',
        );
      }
      const ids = new Set(wanted.map(([id]) => id));
      kept = kept.filter((profile) =>
        [...profile.role_ids, ...(profile.custom_role_ids ?? [])].some((id) =>
          ids.has(id),
        ),
      );
      // Each matched role with its own count, so "how many chairs" is read
      // and not counted from the list.
      for (const [id, name] of wanted) {
        const holders = profiles.filter((profile) =>
          [...profile.role_ids, ...(profile.custom_role_ids ?? [])].includes(
            id,
          ),
        ).length;
        summary.push(`${name} is held by ${count(holders, 'member')}.`);
      }
    }
    if (args.group) {
      const wanted = matchByName(groups, (group) => group.name, args.group);
      if (wanted.length === 0) {
        return nothing(context, 'No group, class or class year has that name.');
      }
      const inGroup = new Set(wanted.flatMap((group) => group.member_ids));
      kept = kept.filter((profile) => inGroup.has(profile.user_id));
      for (const group of wanted) {
        summary.push(
          `${groupLabel(group)} has ${count(group.member_ids.length, 'member')}.`,
        );
      }
    }
    if (!args.role && !args.group) {
      const alumni = profiles.filter((profile) => profile.is_alumni).length;
      summary.push(
        `The chapter has ${count(profiles.length, 'member')}: ${profiles.length - alumni} active and ${alumni} alumni.`,
      );
    } else {
      summary.push(`${count(kept.length, 'member')} listed.`);
    }
    if (kept.length === 0) {
      return nothing(context, 'No member fits that role and group.');
    }

    const people = new People(kept);
    const rows = [...kept]
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .map((profile) => {
        const held = rolesHeld(profile, names);
        return `${people.name(profile.user_id)}: ${held.length > 0 ? held.join(', ') : 'no role'}${profile.is_alumni ? ' (alumni member)' : ''}`;
      });
    const shown = fitRows(summary, rows, ROSTER_LIMIT);
    const cut = rows.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'more member')} not listed here. The Members page has all of them.`
        : null;
    return found(
      context,
      liveSource({
        id: listSourceId(this.name, args.role, args.group),
        kind: 'roster',
        title: 'Roster',
        page: 'members',
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      people,
      cutLine ? `Showing ${shown.length} of ${rows.length} members.` : null,
    );
  }
}
