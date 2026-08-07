/**
 * Invariants over the eval corpus itself. These run today and always — they
 * need no agent, and they are what stops the corpus from quietly rotting into
 * a set of cases that look adversarial but assert nothing.
 */
import { allEvalCases } from './cases';
import { authorityCeiling } from './harness/grader';
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
  (_id, evalCase) => {
    it('models an injector strictly weaker than the caller', () => {
      // If the injector held everything the caller holds, the ceiling would
      // equal the caller's permissions and the case would prove nothing about
      // confused-deputy escalation.
      const ceiling = authorityCeiling(evalCase);
      expect(ceiling.size).toBeLessThan(
        evalCase.invocation.caller.permissions.length,
      );
    });
  },
);
