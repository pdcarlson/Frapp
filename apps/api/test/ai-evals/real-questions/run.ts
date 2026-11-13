/**
 * Ask the real-question set of one agent, over one or more models at one or
 * more efforts, and report what the bake-off needs to pick a model with
 * numbers (#4903): quality, model calls, time and cost per question, and how
 * many questions fit a chapter's monthly cap.
 *
 * One **arm** is a model at an effort. Every arm gets the same questions,
 * the same agent and the same chapter; only the model and its effort change
 * (`bake-off/candidate-registry.ts`).
 *
 * - **Code checks**: questions with no violation from `code-grader.ts`, over
 *   all attempts. A provider error on a question fails that attempt.
 * - **Judge**: questions the judge passed on all five criteria, when a judge
 *   was named. `n/a` otherwise.
 * - **Right**: passed both. This is the headline; with no judge it is the
 *   code checks alone, and the report says so.
 * - **Model calls**: provider calls per question, the same thing as rounds
 *   for a loop. The one-shot Ask makes two (plan, answer).
 * - **Time**: wall clock per question, median and 95th percentile.
 * - **Cost**: the gateway's recorded tokens at the candidate's price on the
 *   run's date. An estimate that does not discount cached input, so a loop
 *   with a cached prefix costs less than this says.
 * - **Questions per cap**: the chapter's monthly cap divided by the mean
 *   cost of a question.
 *
 * Nothing here keeps or prints a question's sources or an answer: the
 * report carries question ids, rule names and counts. `shown-to-model`
 * scans each request for the question's forbidden words and keeps a yes or
 * no.
 */
import {
  LanguageModelError,
  type LanguageModelEffort,
  type LanguageModelRequest,
} from '#domain/adapters/language-model.interface';
import {
  candidateRegistry,
  type CandidateOptions,
} from '../bake-off/candidate-registry';
import {
  costUsd,
  findCandidate,
  priceOn,
  type BakeOffCandidate,
} from '../bake-off/candidates';
import { scriptedAskPlanner } from '../harness/ask-agent';
import { createEvalGateway } from '../harness/eval-gateway';
import type { EvalViolation } from '../harness/grader';
import { findRealQuestionAgent } from './agents';
import { gradeRealQuestion } from './code-grader';
import { REAL_QUESTIONS } from './index';
import { evalCaseFor } from './invocation';
import {
  JUDGE_TASK,
  createJudge,
  scriptedJudge,
  type Judge,
  type JudgeCriterion,
} from './judge';
import { scriptedRealAnswer } from './scripted';
import {
  QUESTION_GROUPS,
  type QuestionGroup,
  type RealQuestion,
} from './types';

/** The chapter's monthly AI cap in US dollars (`billing.md` § Caps). */
export const CHAPTER_MONTHLY_CAP_USD = 25;

/** `catalog` leaves each task at the effort the model catalog gives it. */
export type ArmEffort = LanguageModelEffort | 'catalog';

export interface AttemptResult {
  questionId: string;
  group: QuestionGroup;
  violations: EvalViolation[];
  /** Null when no judge ran, or the answer never arrived. */
  judge: { pass: boolean; failed: JudgeCriterion[] } | null;
  modelCalls: number;
  seconds: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ArmResult {
  candidate: BakeOffCandidate;
  effort: ArmEffort;
  attempts: AttemptResult[];
}

export interface RealRun {
  agent: string;
  /** `YYYY-MM-DD`, the date prices were taken at. */
  date: string;
  questions: number;
  runsEach: number;
  /** The judge's model id, or null when answers were graded by code alone. */
  judge: string | null;
  judgeCostUsd: number;
  arms: ArmResult[];
}

export interface RealRunOptions {
  models: string[];
  efforts?: ArmEffort[];
  /** How many times each question is asked of each arm. A real model varies. */
  runs?: number;
  agent?: string;
  /** A bake-off candidate id to judge with. Left out, code checks only. */
  judge?: string;
  /** Question ids to ask. Left out, the whole set. */
  only?: string[];
  /** Ask these instead of the set: a draft being tried before it is added. */
  questions?: readonly RealQuestion[];
  env?: Record<string, string | undefined>;
  date?: string;
}

const SCRIPTED = {
  'ask.answer': scriptedRealAnswer,
  'ask.plan': scriptedAskPlanner,
  [JUDGE_TASK]: scriptedJudge,
};

function buildJudge(
  id: string,
  env: Record<string, string | undefined>,
): { judge: Judge; candidate: BakeOffCandidate } {
  const candidate = findCandidate(id);
  const adapter = candidateRegistry(candidate, SCRIPTED, env).registry.resolve(
    candidate.provider,
  );
  if (!adapter) throw new Error(`No adapter for the judge ${id}`);
  return { judge: createJudge(adapter, candidate.model), candidate };
}

export async function runRealQuestions(
  options: RealRunOptions,
): Promise<RealRun> {
  const env = options.env ?? process.env;
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const runsEach = options.runs ?? 1;
  const agentName = options.agent ?? 'one-shot';
  const createAgent = findRealQuestionAgent(agentName);
  const pool = options.questions ?? REAL_QUESTIONS;
  const questions: readonly RealQuestion[] = options.only
    ? pool.filter((q) => options.only?.includes(q.id))
    : pool;
  if (questions.length === 0) throw new Error('No question matches --only');

  // Everything is resolved and built before the first call, so a typo, a
  // missing key or the paid switch left off fails before money is spent.
  const judging = options.judge ? buildJudge(options.judge, env) : null;
  let watch: readonly string[] = [];
  let shown = new Set<string>();
  const onRequest: CandidateOptions['onRequest'] = (
    request: LanguageModelRequest,
  ) => {
    if (watch.length === 0) return;
    const sent = JSON.stringify(request).toLowerCase();
    for (const word of watch) {
      if (sent.includes(word.toLowerCase())) shown.add(word);
    }
  };
  const arms = options.models.flatMap((model) => {
    const candidate = findCandidate(model);
    return (options.efforts ?? ['catalog']).map((effort) => ({
      candidate,
      effort,
      metered: candidateRegistry(candidate, SCRIPTED, env, {
        ...(effort === 'catalog' ? {} : { effort }),
        onRequest,
      }),
    }));
  });

  let judgeCostUsd = 0;
  const results: ArmResult[] = [];
  for (const arm of arms) {
    const { gateway, usage } = createEvalGateway(arm.metered.registry);
    const agent = createAgent({ gateway });
    const price = priceOn(arm.candidate, date);
    const attempts: AttemptResult[] = [];

    // One question at a time: time is per question, and a provider's rate
    // limit is not what is being measured.
    for (let run = 0; run < runsEach; run++) {
      for (const question of questions) {
        const evalCase = evalCaseFor(question);
        watch = question.expect.neverShown ?? [];
        shown = new Set();
        const usageFrom = usage.length;
        const callsFrom = arm.metered.calls.length;
        const startedAt = performance.now();

        let violations: EvalViolation[];
        let text: string | null = null;
        try {
          const answer = await agent.ask(evalCase.invocation);
          text = answer.text;
          violations = gradeRealQuestion(question, answer, evalCase);
        } catch (error) {
          if (!(error instanceof LanguageModelError)) throw error;
          violations = [{ rule: `error:${error.kind}`, detail: error.message }];
        }
        const seconds = (performance.now() - startedAt) / 1000;
        for (const word of shown) {
          violations.push({
            rule: 'shown-to-model',
            detail: `"${word}" was in a request to the model`,
          });
        }
        watch = [];

        const used = usage.slice(usageFrom);
        const tokens = {
          inputTokens: used.reduce((sum, r) => sum + r.inputTokens, 0),
          outputTokens: used.reduce((sum, r) => sum + r.outputTokens, 0),
        };

        let judged: AttemptResult['judge'] = null;
        if (judging && text !== null) {
          const verdict = await judging.judge.grade(question, text);
          judgeCostUsd += costUsd(
            priceOn(judging.candidate, date),
            verdict.usage,
          );
          judged = {
            pass: verdict.pass,
            failed: (Object.keys(verdict.criteria) as JudgeCriterion[]).filter(
              (criterion) => !verdict.criteria[criterion],
            ),
          };
        }

        attempts.push({
          questionId: question.id,
          group: question.group,
          violations,
          judge: judged,
          modelCalls: arm.metered.calls.length - callsFrom,
          seconds,
          ...tokens,
          costUsd: costUsd(price, tokens),
        });
      }
    }
    results.push({ candidate: arm.candidate, effort: arm.effort, attempts });
  }

  return {
    agent: agentName,
    date,
    questions: questions.length,
    runsEach,
    judge: judging?.candidate.model ?? null,
    judgeCostUsd,
    arms: results,
  };
}

// -------------------------------------------------------------------- report

/** An attempt is right when the code checks pass and, if a judge ran, it passed too. */
export function isRight(attempt: AttemptResult): boolean {
  return attempt.violations.length === 0 && (attempt.judge?.pass ?? true);
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.max(
      0,
      Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1),
    )
  ];
}

export interface ArmSummary {
  model: string;
  effort: ArmEffort;
  attempts: number;
  codePassed: number;
  /** Null when no judge ran. */
  judgePassed: number | null;
  right: number;
  byGroup: Record<QuestionGroup, { right: number; of: number }>;
  meanModelCalls: number;
  secondsP50: number;
  secondsP95: number;
  costUsd: number;
  costPerQuestionUsd: number;
  /** Null when a question cost nothing (the scripted model). */
  questionsPerCap: number | null;
}

export function summariseArm(arm: ArmResult): ArmSummary {
  const { attempts } = arm;
  const total = attempts.reduce((sum, a) => sum + a.costUsd, 0);
  const perQuestion = total / attempts.length;
  const judged = attempts.some((a) => a.judge !== null);
  return {
    model: arm.candidate.model,
    effort: arm.effort,
    attempts: attempts.length,
    codePassed: attempts.filter((a) => a.violations.length === 0).length,
    judgePassed: judged ? attempts.filter((a) => a.judge?.pass).length : null,
    right: attempts.filter(isRight).length,
    byGroup: Object.fromEntries(
      QUESTION_GROUPS.map((group) => {
        const inGroup = attempts.filter((a) => a.group === group);
        return [
          group,
          { right: inGroup.filter(isRight).length, of: inGroup.length },
        ];
      }),
    ) as ArmSummary['byGroup'],
    meanModelCalls:
      attempts.reduce((sum, a) => sum + a.modelCalls, 0) / attempts.length,
    secondsP50: percentile(
      attempts.map((a) => a.seconds),
      0.5,
    ),
    secondsP95: percentile(
      attempts.map((a) => a.seconds),
      0.95,
    ),
    costUsd: total,
    costPerQuestionUsd: perQuestion,
    questionsPerCap:
      perQuestion > 0
        ? Math.floor(CHAPTER_MONTHLY_CAP_USD / perQuestion)
        : null,
  };
}

const share = (n: number, of: number): string =>
  of === 0 ? 'n/a' : `${n}/${of} (${((n / of) * 100).toFixed(0)}%)`;

/** The run as Markdown: one row per arm, then what failed, by id and rule. */
export function formatRealRun(run: RealRun): string {
  const scripted = run.arms.every((arm) => !arm.candidate.paid);
  const lines = [
    `Real questions: ${run.agent}, ${run.date}`,
    '',
    `${run.questions} questions, each asked ${run.runsEach} time${run.runsEach === 1 ? '' : 's'} per arm. ` +
      (run.judge
        ? `Judged by \`${run.judge}\` (about $${run.judgeCostUsd.toFixed(2)}).`
        : 'No judge: "Right" is the code checks alone.'),
    ...(scripted
      ? [
          '',
          'Scripted model: these are the reference answers passing through the agent, not a model. Nothing here is a quality number.',
        ]
      : []),
    '',
    '| Model | Effort | Right | Code checks | Judge | Member | Chair | Exec | Refuse | Model calls | Time p50 / p95 | Cost per question | Questions per $25 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const arm of run.arms) {
    const s = summariseArm(arm);
    lines.push(
      `| ${[
        `\`${s.model}\``,
        s.effort,
        share(s.right, s.attempts),
        share(s.codePassed, s.attempts),
        s.judgePassed === null ? 'n/a' : share(s.judgePassed, s.attempts),
        ...QUESTION_GROUPS.map(
          (group) => `${s.byGroup[group].right}/${s.byGroup[group].of}`,
        ),
        s.meanModelCalls.toFixed(1),
        `${s.secondsP50.toFixed(1)} s / ${s.secondsP95.toFixed(1)} s`,
        `$${s.costPerQuestionUsd.toFixed(4)}`,
        s.questionsPerCap === null
          ? 'n/a'
          : s.questionsPerCap.toLocaleString('en-US'),
      ].join(' | ')} |`,
    );
  }

  for (const arm of run.arms) {
    const failed = new Map<string, Set<string>>();
    for (const attempt of arm.attempts) {
      const rules = [
        ...attempt.violations.map((v) => v.rule),
        ...(attempt.judge?.failed ?? []).map((c) => `judge:${c}`),
      ];
      if (rules.length === 0) continue;
      const seen = failed.get(attempt.questionId) ?? new Set<string>();
      rules.forEach((rule) => seen.add(rule));
      failed.set(attempt.questionId, seen);
    }
    if (failed.size === 0) continue;
    lines.push(
      '',
      `Not right, ${arm.candidate.model} at ${arm.effort}:`,
      ...[...failed].map(([id, rules]) => `- ${id}: ${[...rules].join(', ')}`),
    );
  }

  lines.push(
    '',
    'Prices (cost is an estimate from token counts, with no discount for cached input):',
    ...[...new Set(run.arms.map((arm) => arm.candidate))].map((candidate) => {
      const price = priceOn(candidate, run.date);
      return `- ${candidate.model}: $${price.inputUsdPerMillionTokens} in, $${price.outputUsdPerMillionTokens} out per million tokens. ${candidate.priceSource}`;
    }),
  );
  return lines.join('\n');
}
