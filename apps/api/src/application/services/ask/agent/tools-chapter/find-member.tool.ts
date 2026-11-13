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
  matchPerson,
  nothing,
  People,
  plainName,
  wordsArg,
} from './chapter-tool-kit';
import { groupsByMember, roleNames, rolesHeld } from './people';

const MATCH_LIMIT = 8;

const input = z.object({
  name: wordsArg(
    "The person's name, part of it, or a nickname. For example: Jordan, Lee, Jordan Lee.",
  ),
});
type Args = z.infer<typeof input>;

/**
 * One person, by name: the directory (`GET /v1/members`), matched on the
 * name the way a person would look someone up. Several people come back when
 * the name fits several, and the tool never picks between them.
 */
@Injectable()
export class FindMemberAgentTool implements AgentReadTool<Args> {
  readonly name = 'find_member';
  readonly description =
    'Looks up a person in the chapter by name, part of a name or a nickname. Gives their roles and offices, the groups and class they are in, their graduation year and whether they are an alumni member. Returns every member the name fits. Never gives contact details.';
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = null;
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Looking up a member';

  constructor(
    private readonly members: MemberService,
    private readonly rbac: RbacService,
    private readonly groups: ChapterGroupService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    if (!plainName(args.name)) {
      return nothing(context, 'Give a name to look up.');
    }

    // The whole directory, matched here on the name alone: the directory's
    // own search also matches emails and profile fields, and a lookup that
    // did would tell the model whose address or employer holds a word.
    const profiles = await this.members.findProfilesByChapter(
      context.chapterId,
    );
    const matches = matchPerson(
      profiles,
      (profile) => profile.display_name,
      args.name,
    ).sort((a, b) => a.display_name.localeCompare(b.display_name));
    if (matches.length === 0) {
      return nothing(
        context,
        'No member matches that name. The roster tool lists everyone.',
      );
    }

    const [roles, groups] = await Promise.all([
      this.rbac.findByChapter(context.chapterId),
      this.groups.list(context.chapterId),
    ]);
    const names = roleNames(roles);
    const inGroups = groupsByMember(groups);
    const people = new People(matches);
    const rows = matches.map((profile) => {
      const held = rolesHeld(profile, names);
      const memberOf = inGroups.get(profile.user_id) ?? [];
      const parts = [
        `${people.name(profile.user_id)}: ${held.length > 0 ? `holds ${held.join(', ')}` : 'holds no role'}`,
        memberOf.length > 0 ? `In ${memberOf.join(', ')}` : null,
        profile.graduation_year
          ? `Graduation year ${profile.graduation_year}`
          : null,
        profile.is_alumni ? 'Alumni member' : 'Active member',
        profile.user_id === context.userId ? 'This is the member asking' : null,
      ];
      return `${parts.filter(Boolean).join('. ')}.`;
    });
    const summary = [
      matches.length === 1
        ? '1 member matches that name.'
        : `${count(matches.length, 'member')} match that name.`,
    ];
    const shown = fitRows(summary, rows, MATCH_LIMIT);
    const cut = rows.length - shown.length;
    const note =
      cut > 0
        ? `Showing ${shown.length} of ${rows.length} matches. A fuller name narrows it.`
        : matches.length > 1
          ? 'More than one member matches. Say which one is meant, or ask the member, before treating them as one person.'
          : null;
    return found(
      context,
      liveSource({
        id: listSourceId(this.name, args.name),
        kind: 'roster',
        title: 'Roster',
        page: 'members',
        lines: [...summary, ...shown],
      }),
      people,
      note,
    );
  }
}
