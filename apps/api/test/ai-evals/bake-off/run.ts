/**
 * Run one task's cases against one or more candidates, and make the table
 * the bake-off reports (#4311): pass rate, citation precision, refusal rate,
 * latency and estimated cost.
 *
 * - **Pass rate**: cases with no violation, over all cases. A provider error
 *   on a case counts as a failure of that case.
 * - **Citation precision**: of the quotes the model gave, how many are word
 *   for word in the source they name. For Ask that is measured before the
 *   gateway drops the rest; for minutes and tasks, on each item's quote of
 *   the notes. The same rule either way (`isQuoteGrounded`).
 * - **Refusal rate**: provider calls the provider declined under its own
 *   policy. A "don't know" is not a refusal; the cases grade that.
 * - **Latency**: per provider call, median and 95th percentile.
 * - **Cost**: the gateway's recorded token counts at the candidate's price on
 *   the run's date (`candidates.ts`). An estimate, not an invoice.
 *
 * Nothing here prints or keeps prompt or answer text: the table and the
 * failure list carry case ids, rule names and counts.
 */
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import { createEvalGateway } from '../harness/eval-gateway';
import {
  candidateRegistry,
  type CandidateRegistry,
  type MeteredCall,
} from './candidate-registry';
import {
  costUsd,
  findCandidate,
  priceOn,
  type BakeOffCandidate,
} from './candidates';
import { findTask, type BakeOffTask, type CaseOutcome } from './tasks';

export interface CandidateResult {
  candidate: BakeOffCandidate;
  cases: number;
  passed: number;
  /** null when the model gave no quotes at all. */
  citationPrecision: number | null;
  quotes: number;
  calls: number;
  refusals: number;
  errors: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Case id to the rules it failed. No text. */
  failures: Record<string, string[]>;
}

export interface BakeOffRun {
  task: string;
  /** `YYYY-MM-DD`, the date prices were taken at. */
  date: string;
  results: CandidateResult[];
}

export interface RunOptions {
  task: string;
  models: string[];
  env?: Record<string, string | undefined>;
  /** Defaults to today. */
  date?: string;
}

export function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(fraction * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)];
}

async function runCandidate(
  task: BakeOffTask,
  candidate: BakeOffCandidate,
  { registry, calls }: CandidateRegistry,
  date: string,
): Promise<CandidateResult> {
  const { gateway, usage } = createEvalGateway(registry);

  const outcomes: CaseOutcome[] = [];
  // One case at a time: the latency column is per call, and a provider's
  // rate limit is not what is being measured.
  for (const caseId of task.caseIds) {
    try {
      outcomes.push(await task.run(caseId, { gateway }));
    } catch (error) {
      if (!(error instanceof LanguageModelError)) throw error;
      outcomes.push({
        caseId,
        violations: [{ rule: `error:${error.kind}`, detail: error.message }],
        quotes: 0,
        groundedQuotes: 0,
      });
    }
  }

  const cited = calls.filter((call: MeteredCall) => call.quotes > 0);
  const quotes =
    cited.reduce((sum, call) => sum + call.quotes, 0) +
    outcomes.reduce((sum, outcome) => sum + outcome.quotes, 0);
  const grounded =
    cited.reduce((sum, call) => sum + call.groundedQuotes, 0) +
    outcomes.reduce((sum, outcome) => sum + outcome.groundedQuotes, 0);
  const latencies = calls.map((call) => call.latencyMs);
  const inputTokens = usage.reduce(
    (sum, record) => sum + record.inputTokens,
    0,
  );
  const outputTokens = usage.reduce(
    (sum, record) => sum + record.outputTokens,
    0,
  );

  return {
    candidate,
    cases: outcomes.length,
    passed: outcomes.filter((outcome) => outcome.violations.length === 0)
      .length,
    citationPrecision: quotes === 0 ? null : grounded / quotes,
    quotes,
    calls: calls.length,
    refusals: calls.filter((call) => call.outcome === 'refused').length,
    errors: calls.filter((call) => call.outcome === 'error').length,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    inputTokens,
    outputTokens,
    costUsd: costUsd(priceOn(candidate, date), { inputTokens, outputTokens }),
    failures: Object.fromEntries(
      outcomes
        .filter((outcome) => outcome.violations.length > 0)
        .map((outcome) => [
          outcome.caseId,
          [...new Set(outcome.violations.map((v) => v.rule))],
        ]),
    ),
  };
}

export async function runBakeOff(options: RunOptions): Promise<BakeOffRun> {
  const env = options.env ?? process.env;
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  // Resolve every name and build every model before the first call, so a
  // typo, a missing key or the paid-run switch left off fails before
  // anything is spent, not after an earlier candidate's paid calls.
  const task = findTask(options.task);
  const candidates = options.models.map(findCandidate);
  const registries = candidates.map((candidate) =>
    candidateRegistry(
      candidate,
      { ...task.scriptedAlso, [task.name]: task.scripted },
      env,
    ),
  );
  const results: CandidateResult[] = [];
  for (const [index, candidate] of candidates.entries()) {
    results.push(await runCandidate(task, candidate, registries[index], date));
  }
  return { task: options.task, date, results };
}

const percent = (value: number | null): string =>
  value === null ? 'n/a' : `${(value * 100).toFixed(0)}%`;
const ms = (value: number | null): string =>
  value === null ? 'n/a' : `${(value / 1000).toFixed(2)} s`;

/** The run as a Markdown table, ready to paste on #4311. */
export function formatBakeOff(run: BakeOffRun): string {
  const header = [
    `Bake-off: ${run.task}, ${run.date}`,
    '',
    '| Model | Pass rate | Citation precision | Refusal rate | Latency p50 / p95 | Tokens in / out | Est. cost | Price used (in / out per M) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const rows = run.results.map((result) => {
    const price = priceOn(result.candidate, run.date);
    return [
      `\`${result.candidate.model}\``,
      `${result.passed}/${result.cases} (${percent(result.passed / result.cases)})`,
      result.citationPrecision === null
        ? 'n/a'
        : `${percent(result.citationPrecision)} of ${result.quotes}`,
      result.calls === 0
        ? 'n/a'
        : `${percent(result.refusals / result.calls)} of ${result.calls} calls`,
      `${ms(result.latencyP50Ms)} / ${ms(result.latencyP95Ms)}`,
      `${result.inputTokens.toLocaleString('en-US')} / ${result.outputTokens.toLocaleString('en-US')}`,
      `$${result.costUsd.toFixed(4)}`,
      `$${price.inputUsdPerMillionTokens} / $${price.outputUsdPerMillionTokens}`,
    ].join(' | ');
  });
  const failures = run.results.flatMap((result) => {
    const entries = Object.entries(result.failures);
    if (entries.length === 0) return [];
    return [
      '',
      `Failed cases, ${result.candidate.model}:`,
      ...entries.map(([caseId, rules]) => `- ${caseId}: ${rules.join(', ')}`),
    ];
  });
  const sources = [
    '',
    'Prices:',
    ...run.results.map(
      (result) =>
        `- ${result.candidate.model}: ${result.candidate.priceSource}`,
    ),
  ];
  return [
    ...header,
    ...rows.map((row) => `| ${row} |`),
    ...failures,
    ...sources,
  ].join('\n');
}
