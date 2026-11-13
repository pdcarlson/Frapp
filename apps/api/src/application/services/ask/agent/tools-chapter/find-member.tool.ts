import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { ChapterGroupService } from '../../../chapter-group.service';
import { MemberService, type MemberProfile } from '../../../member.service';
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
  nothing,
  People,
  plainName,
  wordsArg,
} from './chapter-tool-kit';
import { groupsByMember, roleNames, rolesHeld } from './people';

const MATCH_LIMIT = 8;
/** A word of the name shorter than this is not searched on its own. */
const WORD_MIN = 3;
const WORDS_SEARCHED = 3;

const input = z.object({
  name: wordsArg(
    "The person's name, part of it, or a nickname. For example: Jordan, Lee, Jordan Lee.",
  ),
});
type Args = z.infer<typeof input>;

/**
 * One person, by name: `GET /v1/members/search`, the directory's own search,
 * with the email left out of the match. Several people come back when the
 * name fits several, and the tool never picks between them.
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

    const matches = await this.search(args.name, context);
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

  /**
   * The directory search on the whole name, and when that finds nobody, on
   * each word of it ("Lee Jordan" for Jordan Lee, a first name with a
   * mistyped last). A member matching more of the words comes first.
   */
  private async search(
    typed: string,
    context: AgentToolContext,
  ): Promise<MemberProfile[]> {
    const read = (query: string) =>
      this.members.searchByChapterAndName(
        context.chapterId,
        query,
        context.userId,
        { matchEmail: false },
      );
    const byName = (a: MemberProfile, b: MemberProfile) =>
      a.display_name.localeCompare(b.display_name);
    // As typed, because the directory matches the name as it is written
    // ("O'Brien"); the words are taken with the punctuation off.
    const whole = await read(typed);
    if (whole.length > 0) return [...whole].sort(byName);

    const words = plainName(typed)
      .split(' ')
      .filter((word) => word.length >= WORD_MIN)
      .slice(0, WORDS_SEARCHED);
    if (words.length < 2) return [];
    const perWord = await Promise.all(words.map(read));
    const hits = new Map<string, { profile: MemberProfile; words: number }>();
    for (const profiles of perWord) {
      for (const profile of profiles) {
        const hit = hits.get(profile.user_id) ?? { profile, words: 0 };
        hit.words += 1;
        hits.set(profile.user_id, hit);
      }
    }
    return [...hits.values()]
      .sort((a, b) => b.words - a.words || byName(a.profile, b.profile))
      .map((hit) => hit.profile);
  }
}
