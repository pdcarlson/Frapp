/**
 * The judge: a model that grades what code cannot (#4903). Code checks that
 * a fact is present; only a reader can say whether the answer was to the
 * question asked, or whether a reversed decision was given as current.
 *
 * The rubric is `judge-rubric.md`, sent word for word as the system prompt.
 * The judge sees the asker, where they asked from, the question, the notes
 * on a right answer and the answer. It never sees the chapter's records, so
 * it grades against the notes and cannot be argued round by a source.
 *
 * A judge is only as good as its agreement with a person. `judge-sample.ts`
 * is the hand-graded sample, and `judgeAgreement` scores a judge against
 * it. Run that before trusting a judged column (`README.md`, "The judge").
 *
 * The call goes straight to the model's adapter, not through the gateway:
 * the judge is not a feature of the product, has no catalog task, and no
 * member's consent or spend cap is behind it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  ILanguageModel,
  LanguageModelEffort,
  LanguageModelRequest,
  LanguageModelUsage,
} from '#domain/adapters/language-model.interface';
import type { ScriptedReply } from '../../../src/infrastructure/ai/scripted-language-model';
import { member } from '../synthetic-chapter/roster';
import { TERM_CHANNEL_NAMES, TERM_EVENTS } from '../synthetic-chapter/term';
import type { RealQuestion } from './types';

export const JUDGE_TASK = 'eval.judge';

export const JUDGE_CRITERIA = [
  'answers_the_question',
  'correct',
  'complete',
  'direct',
  'honest_about_limits',
] as const;

export type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];

const JudgeReply = z.object({
  answers_the_question: z.boolean(),
  correct: z.boolean(),
  complete: z.boolean(),
  direct: z.boolean(),
  honest_about_limits: z.boolean(),
  reason: z.string(),
});

const JUDGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [...JUDGE_CRITERIA, 'reason'],
  properties: {
    ...Object.fromEntries(
      JUDGE_CRITERIA.map((criterion) => [criterion, { type: 'boolean' }]),
    ),
    reason: { type: 'string' },
  },
};

export interface JudgeVerdict {
  criteria: Record<JudgeCriterion, boolean>;
  /** Every criterion true. Worked out here, not asked of the judge. */
  pass: boolean;
  reason: string;
  usage: LanguageModelUsage;
}

/** The rubric, from the first rule to the end of the file: what the judge is told. */
export function judgeRubric(): string {
  const file = readFileSync(join(__dirname, 'judge-rubric.md'), 'utf8');
  const start = file.indexOf('\n---\n');
  if (start < 0) throw new Error('judge-rubric.md has lost its --- divider');
  return file.slice(start + 5).trim();
}

/** What the judge is shown for one answer. */
export function judgeMessage(question: RealQuestion, answer: string): string {
  const asker = member(question.askerId);
  const from = question.from?.channelId
    ? TERM_CHANNEL_NAMES[question.from.channelId]
    : question.from?.eventId
      ? `the event "${TERM_EVENTS.find((e) => e.id === question.from?.eventId)?.name}"`
      : 'the Ask Frapp screen';
  return [
    `Asked by: ${asker.name}, ${asker.role}`,
    `Asked from: ${from}`,
    `Asked on: Thursday, November 12, 2026`,
    `Question: ${question.question}`,
    '',
    `Notes on a right answer: ${question.rightAnswer}`,
    ...(question.expect.decline
      ? ['The right answer here is to decline.']
      : []),
    '',
    '<answer>',
    answer,
    '</answer>',
  ].join('\n');
}

export interface Judge {
  /** The judge's model id, for the report. */
  model: string;
  grade(question: RealQuestion, answer: string): Promise<JudgeVerdict>;
}

export function createJudge(
  adapter: ILanguageModel,
  model: string,
  effort: LanguageModelEffort = 'medium',
): Judge {
  const system = judgeRubric();
  return {
    model,
    async grade(question, answer) {
      const request: LanguageModelRequest = {
        task: JUDGE_TASK,
        model,
        kind: 'structured',
        system,
        messages: [{ role: 'user', content: judgeMessage(question, answer) }],
        schema: JUDGE_SCHEMA,
        maxOutputTokens: 2_000,
        effort,
      };
      const result = await adapter.generate(request);
      if (result.outcome !== 'completed') {
        // A judge that declines has judged nothing. Failing the answer is
        // the safe reading; the reason says it was the judge.
        return {
          criteria: Object.fromEntries(
            JUDGE_CRITERIA.map((criterion) => [criterion, false]),
          ) as Record<JudgeCriterion, boolean>,
          pass: false,
          reason: 'The judge declined to grade this answer.',
          usage: result.usage,
        };
      }
      const { reason, ...criteria } = JudgeReply.parse(result.object);
      return {
        criteria,
        pass: JUDGE_CRITERIA.every((criterion) => criteria[criterion]),
        reason,
        usage: result.usage,
      };
    },
  };
}

/**
 * The scripted judge passes everything. It exists so the path runs with no
 * key; a column it filled says nothing about an answer, and the report
 * labels it.
 */
export function scriptedJudge(): ScriptedReply {
  const object = {
    ...Object.fromEntries(JUDGE_CRITERIA.map((criterion) => [criterion, true])),
    reason: 'Scripted judge: not a judgment.',
  };
  return { text: JSON.stringify(object), object };
}

// ------------------------------------------------------------------ agreement

export interface HandGraded {
  questionId: string;
  answer: string;
  /** The criteria a person failed it on. Empty means it passes. */
  fails: readonly JudgeCriterion[];
  /** Why, for whoever reads a disagreement. */
  why: string;
}

export interface JudgeAgreement {
  judge: string;
  graded: number;
  /** The judge and the person agree on pass or fail. */
  agreed: number;
  /** The judge passed what a person failed: the direction that hides a bad answer. */
  falsePasses: string[];
  /** The judge failed what a person passed. */
  falseFails: string[];
  /** Per criterion, how many of the sample the judge called the same way. */
  byCriterion: Record<JudgeCriterion, number>;
  usage: { inputTokens: number; outputTokens: number };
}

export async function judgeAgreement(
  judge: Judge,
  sample: readonly HandGraded[],
  find: (questionId: string) => RealQuestion,
): Promise<JudgeAgreement> {
  const out: JudgeAgreement = {
    judge: judge.model,
    graded: 0,
    agreed: 0,
    falsePasses: [],
    falseFails: [],
    byCriterion: Object.fromEntries(
      JUDGE_CRITERIA.map((criterion) => [criterion, 0]),
    ) as Record<JudgeCriterion, number>,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  for (const [index, item] of sample.entries()) {
    const verdict = await judge.grade(find(item.questionId), item.answer);
    const handPass = item.fails.length === 0;
    const label = `${item.questionId}#${index}`;
    out.graded += 1;
    if (verdict.pass === handPass) out.agreed += 1;
    else if (verdict.pass) out.falsePasses.push(label);
    else out.falseFails.push(label);
    for (const criterion of JUDGE_CRITERIA) {
      if (verdict.criteria[criterion] === !item.fails.includes(criterion)) {
        out.byCriterion[criterion] += 1;
      }
    }
    out.usage.inputTokens += verdict.usage.inputTokens;
    out.usage.outputTokens += verdict.usage.outputTokens;
  }
  return out;
}

export function formatAgreement(result: JudgeAgreement): string {
  const pct = (n: number) =>
    result.graded === 0 ? 'n/a' : `${((n / result.graded) * 100).toFixed(0)}%`;
  return [
    `Judge agreement with hand grades: ${result.judge}`,
    '',
    `Pass or fail: ${result.agreed}/${result.graded} (${pct(result.agreed)})`,
    `Passed what a person failed: ${result.falsePasses.length}${result.falsePasses.length ? ` (${result.falsePasses.join(', ')})` : ''}`,
    `Failed what a person passed: ${result.falseFails.length}${result.falseFails.length ? ` (${result.falseFails.join(', ')})` : ''}`,
    '',
    '| Criterion | Agreed |',
    '| --- | --- |',
    ...JUDGE_CRITERIA.map(
      (criterion) =>
        `| \`${criterion}\` | ${result.byCriterion[criterion]}/${result.graded} (${pct(result.byCriterion[criterion])}) |`,
    ),
  ].join('\n');
}
