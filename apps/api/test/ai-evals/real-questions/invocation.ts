/**
 * A real question as the harness asks it: the asker as a caller with their
 * role's permissions and channels, the term chapter as corpus and records,
 * and where they asked from.
 */
import { ALUMNUS, MEMBER, PRESIDENT, TREASURER } from '../cases/fixtures';
import { termReadsFor } from '../harness/term-reads';
import type { AgentInvocation, EvalCaller, EvalCase } from '../harness/types';
import {
  EXEC_ROLES,
  member,
  type SyntheticMember,
} from '../synthetic-chapter/roster';
import { TERM_CHAPTER, type TermChapter } from '../synthetic-chapter/term';
import type { RealQuestion } from './types';

/** When every real question is asked: Thursday, November 12, 2026, noon Eastern. */
export const ASKED_AT = new Date('2026-11-12T17:00:00.000Z');

const TREASURER_ONLY = new Set([
  'billing:view',
  'billing:manage',
  'points:adjust',
  'points:view_all',
  'reports:export',
]);

/** What a chair's custom role adds to the member defaults. Real permission names. */
const CHAIR_EXTRAS: Readonly<Record<string, string[]>> = {
  'Philanthropy Chair': ['service:approve'],
  'Social Chair': ['events:update'],
  'House Manager': ['tasks:manage'],
};

/**
 * A synthetic member's permissions. President, Treasurer, Everyone and
 * Alumni are the seeded roles' grants (`cases/fixtures.ts`). The other
 * officers get the Exec board tier without the Treasurer's own grants, and a
 * chair gets the member defaults plus the one thing the chair does. Those
 * two are this chapter's custom roles, not seeded ones.
 */
export function permissionsFor(person: SyntheticMember): string[] {
  if (person.role === 'President') return PRESIDENT.permissions;
  if (person.role === 'Treasurer') return TREASURER.permissions;
  if (person.role === 'Alumni') return ALUMNUS.permissions;
  if (EXEC_ROLES.has(person.role)) {
    return TREASURER.permissions.filter((p) => !TREASURER_ONLY.has(p));
  }
  return [...MEMBER.permissions, ...(CHAIR_EXTRAS[person.role] ?? [])];
}

export function callerFor(
  askerId: string,
  chapter: TermChapter = TERM_CHAPTER,
): EvalCaller {
  const person = member(askerId);
  return {
    memberId: person.id,
    chapterId: chapter.chapterId,
    roleName: person.role,
    permissions: permissionsFor(person),
    channelIds: chapter.channelsFor(person),
  };
}

export function invocationFor(
  question: RealQuestion,
  chapter: TermChapter = TERM_CHAPTER,
): AgentInvocation {
  const person = member(question.askerId);
  return {
    question: question.question,
    caller: callerFor(question.askerId, chapter),
    corpus: [...chapter.corpus],
    toolResults: termReadsFor(chapter, question.askerId, ASKED_AT),
    asker: {
      name: person.name,
      roles: [person.role],
      alumni: person.role === 'Alumni',
    },
    ...(question.from ? { from: question.from } : {}),
    chapter,
  };
}

/** The question as a case of the adversarial grader, whose universal rules read its corpus and caller. */
export function evalCaseFor(question: RealQuestion): EvalCase {
  return {
    id: question.id,
    category: 'missing-information',
    intent: question.rightAnswer,
    invocation: invocationFor(question),
    expect: {},
  };
}
