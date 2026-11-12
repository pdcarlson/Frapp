import { Injectable, Logger } from '@nestjs/common';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import { AiGatewayService } from '../ai/ai-gateway.service';
import { MemberService } from '../member.service';
import { RbacService } from '../rbac.service';
import {
  ACT_MATCH_PROMPT_VERSION,
  ACT_MATCH_SYSTEM,
  ActMatchSchema,
  actMatchMessage,
} from './act-prompt';
import type { ActNote, ActToolContext } from './act-tool';

/** Names one request may carry; the rest are dropped. */
export const ACT_PEOPLE_MAX = 60;
/** A typed name longer than this is not a name. */
const NAME_MAX_LENGTH = 80;
/** Names sent to the matching call at once. */
const MATCH_NAMES_MAX = 10;
/** Roster lines the matching call is shown. A larger chapter is not matched by a model. */
const MATCH_ROSTER_MAX = 400;

const SELF = new Set(['me', 'myself', 'i']);
/** Words in front of a role that are not part of its name ("all the pledges"). */
const ROLE_LEAD = new Set([
  'all',
  'the',
  'every',
  'our',
  'everyone',
  'in',
  'on',
]);

interface RosterMember {
  userId: string;
  name: string;
  tokens: string[];
  roleIds: Set<string>;
}

function tokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** One line, no separators: a display name is member-written text. */
function rosterLine(name: string): string {
  return name
    .replace(/[\r\n:;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX_LENGTH);
}

function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

/**
 * The members a typed name could be, strongest reading first: the whole
 * name; then every typed word being one of the member's words (a first name,
 * a last name, or both in either order); then every typed word starting one
 * ("Jor" for Jordan). The first reading that finds anyone decides.
 */
export function membersNamed(
  typed: string,
  roster: readonly RosterMember[],
): RosterMember[] {
  const want = tokens(typed);
  if (want.length === 0) return [];
  const whole = want.join(' ');
  const exact = roster.filter((member) => member.tokens.join(' ') === whole);
  if (exact.length > 0) return exact;
  const words = roster.filter((member) =>
    want.every((word) => member.tokens.includes(word)),
  );
  if (words.length > 0) return words;
  if (want.some((word) => word.length < 3)) return [];
  return roster.filter((member) =>
    want.every((word) => member.tokens.some((have) => have.startsWith(word))),
  );
}

export interface ResolvedPeople {
  /** Members of this chapter, in the order they were named, each once. */
  userIds: string[];
  notes: ActNote[];
}

/**
 * Turns the names an officer typed into members of **this chapter** (#718).
 *
 * The roster is read here, as the request's chapter, and a name can only
 * ever resolve to a row of it: there is no path by which a model, or a name,
 * reaches a member of another chapter
 * (`docs/security/ai-prompt-injection.md` C4).
 *
 * A name the lookup cannot place goes to one small model call that is shown
 * the leftover names and the roster and may answer only with a roster line
 * number. Display names are member-written, so that call is the one place in
 * the acting agent where a model reads someone else's text. What it can do
 * with it is bounded: the action was already chosen from the officer's words
 * alone, so the most a planted name can change is which member a typed name
 * lands on, and the card flags every such match for the officer to check.
 */
@Injectable()
export class ActPeopleResolver {
  private readonly logger = new Logger(ActPeopleResolver.name);

  constructor(
    private readonly members: MemberService,
    private readonly rbac: RbacService,
    private readonly gateway: AiGatewayService,
  ) {}

  async resolve(
    typedNames: readonly string[],
    context: ActToolContext,
    options: { roles: boolean },
  ): Promise<ResolvedPeople> {
    const names = [
      ...new Set(
        typedNames
          .map((name) => name.replace(/\s+/g, ' ').trim())
          .filter((name) => name.length > 0 && name.length <= NAME_MAX_LENGTH),
      ),
    ].slice(0, ACT_PEOPLE_MAX);
    if (names.length === 0) return { userIds: [], notes: [] };

    const [profiles, roles] = await Promise.all([
      this.members.findProfilesByChapter(context.chapterId),
      options.roles
        ? this.rbac.findByChapter(context.chapterId)
        : Promise.resolve<{ id: string; name: string }[]>([]),
    ]);
    const roster: RosterMember[] = profiles.map((profile) => ({
      userId: profile.user_id,
      name: profile.display_name ?? '',
      tokens: tokens(profile.display_name ?? ''),
      roleIds: new Set([
        ...(profile.role_ids ?? []),
        ...(profile.custom_role_ids ?? []),
      ]),
    }));

    const userIds: string[] = [];
    const notes: ActNote[] = [];
    const add = (ids: readonly string[]) => {
      for (const id of ids) if (!userIds.includes(id)) userIds.push(id);
    };
    const leftover: string[] = [];

    for (const name of names) {
      const words = tokens(name);
      if (words.length === 1 && SELF.has(words[0])) {
        add([context.userId]);
        continue;
      }
      const found = membersNamed(name, roster);
      if (found.length === 1) {
        add([found[0].userId]);
        continue;
      }
      if (found.length > 1) {
        notes.push({
          type: 'ambiguous_name',
          name,
          user_ids: found.slice(0, 10).map((member) => member.userId),
        });
        continue;
      }
      const roleWords = words
        .filter((word, index) => !(index < 3 && ROLE_LEAD.has(word)))
        .map(singular)
        .join(' ');
      const role = roleWords
        ? roles.find(
            (candidate) =>
              tokens(candidate.name).map(singular).join(' ') === roleWords,
          )
        : undefined;
      if (role) {
        const holders = roster
          .filter((member) => member.roleIds.has(role.id))
          .map((member) => member.userId);
        add(holders);
        notes.push({ type: 'role_members', name, count: holders.length });
        continue;
      }
      leftover.push(name);
    }

    const matched = await this.matchLeftover(leftover, roster, context);
    for (const name of leftover) {
      const member = matched.get(name);
      if (member) {
        add([member.userId]);
        notes.push({ type: 'matched_name', name, user_ids: [member.userId] });
      } else {
        notes.push({ type: 'unmatched_name', name });
      }
    }
    return { userIds, notes };
  }

  /**
   * The matching call. A failure, a refusal, a cap or a consent refusal all
   * mean the same thing here: the names stay unmatched and the card says so.
   */
  private async matchLeftover(
    names: readonly string[],
    roster: readonly RosterMember[],
    context: ActToolContext,
  ): Promise<Map<string, RosterMember>> {
    const matched = new Map<string, RosterMember>();
    const asked = names.slice(0, MATCH_NAMES_MAX);
    if (
      asked.length === 0 ||
      roster.length === 0 ||
      roster.length > MATCH_ROSTER_MAX
    ) {
      return matched;
    }
    try {
      const result = await this.gateway.generateObject(
        'act.match',
        {
          promptVersion: ACT_MATCH_PROMPT_VERSION,
          system: ACT_MATCH_SYSTEM,
          messages: [
            {
              role: 'user',
              content: actMatchMessage(
                asked,
                roster.map((member) => rosterLine(member.name)),
              ),
            },
          ],
          schema: ActMatchSchema,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        },
        { chapterId: context.chapterId, actingUserId: context.userId },
      );
      if (result.status !== 'ok') return matched;
      for (const match of result.value.matches) {
        // Only a name that was asked about, and only a line of this roster.
        if (!asked.includes(match.name) || matched.has(match.name)) continue;
        const line = match.member;
        if (line === null || !Number.isInteger(line)) continue;
        const member = roster[line - 1];
        if (member) matched.set(match.name, member);
      }
    } catch (error) {
      if (error instanceof LanguageModelError && error.kind === 'aborted') {
        throw error;
      }
      this.logger.warn(
        `Act: the name-matching call failed (${
          error instanceof LanguageModelError ? error.kind : 'unknown'
        }); names left unmatched`,
      );
    }
    return matched;
  }
}
