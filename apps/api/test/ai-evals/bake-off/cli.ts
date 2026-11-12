/**
 * The bake-off command (#4311).
 *
 *   npm run ai:bake-off -w apps/api -- --task minutes.draft \
 *     --models claude-sonnet-5-5,claude-haiku-5-5,gemini-3.8-flash,gemini-3.5-flash-lite
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
import { BAKE_OFF_CANDIDATES } from './candidates';
import { formatBakeOff, runBakeOff } from './run';
import { BAKE_OFF_TASKS } from './tasks';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      task: { type: 'string' },
      models: { type: 'string' },
      out: { type: 'string' },
      date: { type: 'string' },
    },
  });
  if (!values.task || !values.models) {
    process.stderr.write(
      [
        'Usage: npm run ai:bake-off -w apps/api -- --task <task> --models <id,id> [--out <file>] [--date YYYY-MM-DD]',
        `Tasks: ${BAKE_OFF_TASKS.map((t) => t.name).join(', ')}`,
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
