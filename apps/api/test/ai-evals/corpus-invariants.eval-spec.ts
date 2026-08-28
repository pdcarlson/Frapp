/**
 * Invariants over the eval corpus itself. These run today and always — they
 * need no agent, and they are what stops the corpus from quietly rotting into
 * a set of cases that look adversarial but assert nothing.
 */
import { allEvalCases } from './cases';
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
