/**
 * The bake-off command (#4311).
 *
 *   npm run ai:bake-off -w apps/api -- --task minutes.draft \
 *     --models claude-sonnet-5-5,claude-haiku-5-5,gemini-3.8-flash,gemini-3.5-flash-lite
 *
 * Two more tasks run the real-question set (#4903, `real-questions/`):
 *
 *   npm run ai:bake-off -w apps/api -- --task ask.real \
 *     --models claude-sonnet-5-5,claude-opus-5-5,claude-haiku-5-5 \
 *     --efforts low,medium --runs 3 --judge claude-opus-5-5 --out real.md
 *
 *   npm run ai:bake-off -w apps/api -- --task judge.agreement --judge claude-opus-5-5
 *
 * `ask.real` asks every real question of each model at each effort and
 * reports quality, model calls, time and cost per question. `--agent` picks
 * what is asked (`one-shot` today), `--only id,id` a few questions, and
 * `--json <file>` writes the whole run for a result page.
 * `judge.agreement` scores a judge against the hand-graded sample.
 *
 * Prints the Markdown table, and with `--out <file>` writes it there too.
 * `--models scripted` runs the whole path with no network and no cost.
 *
 * A paid model needs its provider's credentials in the environment (the
 * names the API reads, `docs/internal/environment/ENV_REFERENCE.md`) and
 * `AI_EVALS_ALLOW_PAID=1`. This is never run by CI.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { REAL_QUESTIONS, findQuestion } from '../real-questions';
import {
  JUDGE_TASK,
  createJudge,
  formatAgreement,
  judgeAgreement,
  scriptedJudge,
} from '../real-questions/judge';
import { HAND_GRADED_SAMPLE } from '../real-questions/judge-sample';
import {
  formatRealRun,
  runRealQuestions,
  type ArmEffort,
} from '../real-questions/run';
import { candidateRegistry } from './candidate-registry';
import {
  BAKE_OFF_CANDIDATES,
  costUsd,
  findCandidate,
  priceOn,
} from './candidates';
import { formatBakeOff, runBakeOff } from './run';
import { BAKE_OFF_TASKS } from './tasks';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      task: { type: 'string' },
      models: { type: 'string' },
      out: { type: 'string' },
      date: { type: 'string' },
      efforts: { type: 'string' },
      runs: { type: 'string' },
      agent: { type: 'string' },
      judge: { type: 'string' },
      only: { type: 'string' },
      json: { type: 'string' },
    },
  });
  const list = (value: string | undefined): string[] | undefined =>
    value?.split(',').map((item) => item.trim());
  const emit = (text: string): void => {
    process.stdout.write(`${text}\n`);
    if (values.out) writeFileSync(values.out, `${text}\n`);
  };

  if (values.task === 'judge.agreement') {
    if (!values.judge) throw new Error('judge.agreement needs --judge <model>');
    process.env.AI_ENABLED = 'true';
    const candidate = findCandidate(values.judge);
    const adapter = candidateRegistry(candidate, {
      [JUDGE_TASK]: scriptedJudge,
    }).registry.resolve(candidate.provider);
    if (!adapter) throw new Error(`No adapter for ${values.judge}`);
    const agreement = await judgeAgreement(
      createJudge(adapter, candidate.model),
      HAND_GRADED_SAMPLE,
      findQuestion,
    );
    const today = new Date().toISOString().slice(0, 10);
    emit(
      formatAgreement(
        agreement,
        costUsd(priceOn(candidate, values.date ?? today), agreement.usage),
      ),
    );
    return;
  }

  if (values.task === 'ask.real' && values.models) {
    process.env.AI_ENABLED = 'true';
    const runs = Number(values.runs ?? '1');
    if (!Number.isInteger(runs) || runs < 1) {
      throw new Error('--runs takes a whole number, 1 or more');
    }
    const efforts = list(values.efforts) ?? ['catalog'];
    for (const effort of efforts) {
      if (!['catalog', 'low', 'medium', 'high'].includes(effort)) {
        throw new Error(
          `--efforts takes catalog, low, medium or high, not "${effort}"`,
        );
      }
    }
    const run = await runRealQuestions({
      models: list(values.models) ?? [],
      efforts: efforts as ArmEffort[],
      runs,
      agent: values.agent,
      judge: values.judge,
      only: list(values.only),
      date: values.date,
    });
    emit(formatRealRun(run));
    if (values.json)
      writeFileSync(values.json, `${JSON.stringify(run, null, 2)}\n`);
    return;
  }

  if (!values.task || !values.models) {
    process.stderr.write(
      [
        'Usage: npm run ai:bake-off -w apps/api -- --task <task> --models <id,id> [--out <file>] [--date YYYY-MM-DD]',
        `Tasks: ${BAKE_OFF_TASKS.map((t) => t.name).join(', ')}, ask.real (${REAL_QUESTIONS.length} real questions; also --efforts --runs --agent --judge --only --json), judge.agreement (--judge)`,
        `Models: ${BAKE_OFF_CANDIDATES.map((c) => c.id).join(', ')}`,
        '',
      ].join('\n'),
    );
    process.exitCode = 2;
    return;
  }

  // The gateway makes no call with the server switch off. This process is
  // the bake-off, nothing else.
  process.env.AI_ENABLED = 'true';
  const run = await runBakeOff({
    task: values.task,
    models: values.models.split(',').map((model) => model.trim()),
    date: values.date,
  });
  const table = formatBakeOff(run);
  process.stdout.write(`${table}\n`);
  if (values.out) writeFileSync(values.out, `${table}\n`);
}

main().catch((error: unknown) => {
  // Only the message: a provider error carries no provider text, and
  // nothing else here holds any.
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
