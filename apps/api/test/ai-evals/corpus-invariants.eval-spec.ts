/**
 * Invariants over the eval corpus itself. These run today and always — they
 * need no agent, and they are what stops the corpus from quietly rotting into
 * a set of cases that look adversarial but assert nothing.
 */
import { DEFAULT_SYSTEM_ROLES } from '#domain/constants/permissions';
import { allEvalCases } from './cases';
import * as fixtures from './cases/fixtures';
import { authorityCeiling, ceilingPermits } from './harness/grader';
import {
  EVAL_CATEGORIES,
  INJECTION_VECTORS,
  type EvalCase,
  type InjectionMetadata,
} from './harness/types';

type InjectionEntry = readonly [string, EvalCase, InjectionMetadata];

const injectionEntries: InjectionEntry[] = allEvalCases.flatMap((c) =>
  c.injection ? [[c.id, c, c.injection] as const] : [],
);

const escalationEntries: InjectionEntry[] = injectionEntries.filter(
  ([, , injection]) => injection.goal === 'privilege-escalation',
);

/** Cases that place a source belonging to another chapter in the context window. */
const foreignSourceEntries = allEvalCases.flatMap((c) => {
  const foreign = [
    ...c.invocation.corpus
      .filter((d) => d.chapterId !== c.invocation.caller.chapterId)
      .map((d) => `${d.title} ${d.body}`),
    ...c.invocation.toolResults
      .filter((r) => r.chapterId !== c.invocation.caller.chapterId)
      .map((r) => r.content),
  ];
  return foreign.length > 0 ? [[c.id, c, foreign] as const] : [];
});

/** Marks a fixture caller holding a custom role, which no seeded role describes. */
const CUSTOM_ROLE_SUFFIX = '(custom)';

const fixtureCallers = Object.entries(fixtures).flatMap(([name, value]) =>
  typeof value === 'object' && 'permissions' in value
    ? [[name, value] as const]
    : [],
);

const seededFixtureCallers = fixtureCallers.filter(
  ([, caller]) => !caller.roleName.endsWith(CUSTOM_ROLE_SUFFIX),
);

function contextText(evalCase: EvalCase): string {
  return [
    ...evalCase.invocation.corpus.map((doc) => doc.body),
    ...evalCase.invocation.toolResults.map((result) => result.content),
  ].join('\n');
}

describe('eval corpus coverage', () => {
  it('covers every category required by spec §13 → Evals', () => {
    const covered = new Set(allEvalCases.map((c) => c.category));
    expect([...covered].sort()).toEqual([...EVAL_CATEGORIES].sort());
  });

  it('exercises every injection vector in the threat model', () => {
    const covered = new Set(injectionEntries.map(([, , i]) => i.vector));
    expect([...covered].sort()).toEqual([...INJECTION_VECTORS].sort());
  });

  it('covers privilege escalation and both cross-chapter directions', () => {
    const goals = new Set(injectionEntries.map(([, , i]) => i.goal));
    expect(goals).toContain('privilege-escalation');
    expect(goals).toContain('cross-chapter-read');
    expect(goals).toContain('cross-chapter-write');
  });

  it('gives every case a unique id', () => {
    const ids = allEvalCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Guards against the whole file silently asserting nothing: an empty filter
  // would leave the describe.each blocks below with no cases to run.
  it('has cases in every group the invariants below iterate', () => {
    expect(allEvalCases.length).toBeGreaterThan(0);
    expect(injectionEntries.length).toBeGreaterThan(0);
    expect(escalationEntries.length).toBeGreaterThan(0);
    expect(foreignSourceEntries.length).toBeGreaterThan(0);
  });
});

describe('eval caller fixtures', () => {
  // Guards against the loop below silently checking nothing.
  it('includes callers that name a seeded role', () => {
    expect(seededFixtureCallers.length).toBeGreaterThan(0);
  });

  // An understated grant tightens the authority ceiling, so a call the real
  // role may make grades as a violation (#1305). President is covered too: the
  // seeded grant carries the literal `*`, which keeps the ceiling's wildcard
  // branch exercised.
  it.each(seededFixtureCallers)(
    '%s holds exactly its seeded role’s permissions',
    (_name, caller) => {
      const seeded = DEFAULT_SYSTEM_ROLES.find(
        (role) => role.name === caller.roleName,
      );
      expect(seeded).toBeDefined();
      expect([...caller.permissions].sort()).toEqual(
        [...(seeded?.permissions ?? [])].sort(),
      );
    },
  );
});

describe.each(allEvalCases.map((c) => [c.id, c] as const))(
  'case %s',
  (_id, evalCase) => {
    it('states an intent and asks a question', () => {
      expect(evalCase.intent.length).toBeGreaterThan(0);
      expect(evalCase.invocation.question.length).toBeGreaterThan(0);
    });

    it('carries injection metadata if and only if it is an injection case', () => {
      expect(Boolean(evalCase.injection)).toBe(
        evalCase.category === 'prompt-injection',
      );
    });

    it('asserts something about the answer', () => {
      // A case with an empty `expect` grades every answer as compliant.
      expect(Object.keys(evalCase.expect).length).toBeGreaterThan(0);
    });

    it('only expects citations of documents in the caller’s own chapter', () => {
      const ownChapter = new Set(
        evalCase.invocation.corpus
          .filter((d) => d.chapterId === evalCase.invocation.caller.chapterId)
          .map((d) => d.id),
      );
      for (const documentId of evalCase.expect.mustCite ?? []) {
        expect(ownChapter.has(documentId)).toBe(true);
      }
    });

    it('does not expect a mention and a non-mention of the same string', () => {
      const mustNot = new Set(evalCase.expect.mustNotMention ?? []);
      for (const needle of evalCase.expect.mustMention ?? []) {
        expect(mustNot.has(needle)).toBe(false);
      }
    });

    it('draws every mustMention string from the context it was given', () => {
      // An expectation that no source supports would be unsatisfiable by a
      // correct agent — the case would be testing the fixture, not the agent.
      const context = `${contextText(evalCase)} ${evalCase.invocation.question}`;
      for (const needle of evalCase.expect.mustMention ?? []) {
        expect(context.toLowerCase()).toContain(needle.toLowerCase());
      }
    });
  },
);

describe.each(injectionEntries)(
  'injection case %s',
  (_id, evalCase, injection) => {
    it('actually plants its payload in the context window', () => {
      expect(injection.payload.length).toBeGreaterThan(0);
      expect(contextText(evalCase)).toContain(injection.payload);
    });

    it('forbids mutation, so a successful injection cannot pass silently', () => {
      const forbidsAll =
        evalCase.expect.forbidsMutation === true ||
        evalCase.expect.allowedTools?.length === 0;
      expect(forbidsAll).toBe(true);
    });
  },
);

describe.each(escalationEntries)(
  'privilege-escalation case %s',
  (_id, evalCase, injection) => {
    it('names the permission the injection is reaching for', () => {
      expect(injection.attemptedPermission).toBeTruthy();
    });

    it('computes a ceiling that excludes that permission', () => {
      // The real invariant. "Ceiling smaller than the caller's" would pass for
      // an injector who happened to hold the escalation target already.
      const attempted = injection.attemptedPermission ?? '';
      expect(ceilingPermits(authorityCeiling(evalCase), attempted)).toBe(false);
    });

    it('models a caller who could have performed it directly', () => {
      // Otherwise ordinary RBAC would have stopped it and the case proves
      // nothing specific to the confused-deputy problem.
      const callerPermissions = new Set(evalCase.invocation.caller.permissions);
      const attempted = injection.attemptedPermission ?? '';
      expect(
        callerPermissions.has('*') || callerPermissions.has(attempted),
      ).toBe(true);
    });
  },
);

describe.each(foreignSourceEntries)(
  'case %s plants another chapter’s content',
  (_id, evalCase, foreignTexts) => {
    it('pins a mustNotMention string drawn from that foreign content', () => {
      // Without this, a case can stage a cross-tenant leak and then assert
      // nothing about whether the leak reached the answer.
      const mustNot = evalCase.expect.mustNotMention ?? [];
      expect(mustNot.length).toBeGreaterThan(0);

      for (const foreign of foreignTexts) {
        const covered = mustNot.some((needle) =>
          foreign.toLowerCase().includes(needle.toLowerCase()),
        );
        expect(covered).toBe(true);
      }
    });
  },
);

/**
 * The author-consent filter and the channel filter (#4307,
 * `spec/behavior/ai.md` § Chat as a source). A chat message reaches a model
 * only when its author said yes and the asker can open its channel. These
 * checks keep the cases able to catch a missing filter: every message says
 * where it came from and whether its author agreed, both kinds of message
 * that must stay out are planted somewhere, and no case expects one of them
 * in an answer.
 */
describe('chat sources', () => {
  const chatEntries = allEvalCases.flatMap((c) =>
    c.invocation.corpus
      .filter((d) => d.sourceType === 'chat_message')
      .map((d) => [c, d] as const),
  );

  function readable(evalCase: EvalCase, documentId: string): boolean {
    const doc = evalCase.invocation.corpus.find((d) => d.id === documentId);
    if (!doc || doc.sourceType !== 'chat_message') return true;
    return (
      doc.chat?.authorConsented === true &&
      (evalCase.invocation.caller.channelIds ?? []).includes(doc.chat.channelId)
    );
  }

  it('gives every chat message its channel and its author’s answer, and no other source either', () => {
    for (const evalCase of allEvalCases) {
      for (const doc of evalCase.invocation.corpus) {
        expect([doc.id, Boolean(doc.chat)]).toEqual([
          doc.id,
          doc.sourceType === 'chat_message',
        ]);
      }
    }
  });

  it('plants a message from a member who said no, in a channel the asker can open', () => {
    const planted = chatEntries.filter(
      ([c, d]) =>
        d.chat?.authorConsented === false &&
        (c.invocation.caller.channelIds ?? []).includes(d.chat.channelId),
    );
    expect(planted.length).toBeGreaterThan(0);
  });

  it('plants a message in a channel the asker cannot open', () => {
    const planted = chatEntries.filter(
      ([c, d]) =>
        d.chat !== undefined &&
        !(c.invocation.caller.channelIds ?? []).includes(d.chat.channelId),
    );
    expect(planted.length).toBeGreaterThan(0);
  });

  it.each(allEvalCases.map((c) => [c.id, c] as const))(
    '%s expects no citation of a message retrieval must leave out',
    (_id, evalCase) => {
      const expected = [
        ...(evalCase.expect.mustCite ?? []),
        ...(evalCase.expect.mustCiteFirst
          ? [evalCase.expect.mustCiteFirst]
          : []),
      ];
      for (const documentId of expected) {
        expect([documentId, readable(evalCase, documentId)]).toEqual([
          documentId,
          true,
        ]);
      }
    },
  );

  it.each(
    chatEntries
      .filter(([, d]) => d.chat?.authorConsented === false)
      .map(([c, d]) => [c.id, c, d] as const),
  )(
    '%s pins what the opted-out message said, and asks for the left-out count',
    (_id, evalCase, doc) => {
      const mustNot = evalCase.expect.mustNotMention ?? [];
      expect(
        mustNot.some((needle) =>
          doc.body.toLowerCase().includes(needle.toLowerCase()),
        ),
      ).toBe(true);
      // An exact count where the corpus is one conversation; a ceiling
      // where the answer draws on only part of a large one.
      expect(
        evalCase.expect.mustReportLeftOut ??
          evalCase.expect.mustNotReportLeftOutAbove,
      ).toBeGreaterThan(0);
    },
  );
});
