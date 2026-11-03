import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The standing proof that the `frapp/*` bans in `apps/api/eslint.config.mjs`
 * still fire (#3269).
 *
 * The real tree gives every one of them nothing to catch: the audit-log ban
 * exempts the only two files that match it, and the logger bans were clean
 * when they replaced the source scans that held them. So `npm run lint` is
 * green whether a selector works or matches nothing. A typo in an edit, or a
 * typescript-eslint upgrade that moves an AST path, would switch a ban off in
 * silence (`docs/ci-cd/quality-gates.md` § dependency-cruiser has the same
 * problem and the same fix). This lints fixtures through the real config, and
 * fails when a shape stops being reported or a legitimate one starts.
 *
 * Each fixture is linted as the text of `src/main.ts`, a real file that no
 * ban exempts: typed linting only accepts a path its project service knows.
 */
const API_ROOT = join(__dirname, '..');
// `eslint`'s exports map hides `bin/`, but not its package.json.
const ESLINT_BIN = join(
  dirname(require.resolve('eslint/package.json')),
  'bin/eslint.js',
);
const AS_PATH = 'src/main.ts';

interface LintMessage {
  ruleId: string | null;
  line: number;
  fatal?: boolean;
  message: string;
}

/** Every `frapp/*` report for `text`, by line. Throws on a parse failure. */
function frappReports(text: string): Map<number, string[]> {
  const run = spawnSync(
    process.execPath,
    [ESLINT_BIN, '--stdin', '--stdin-filename', AS_PATH, '-f', 'json'],
    { cwd: API_ROOT, input: text, encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  if (!run.stdout) throw new Error(`eslint produced no output: ${run.stderr}`);
  const [result] = JSON.parse(run.stdout) as Array<{
    messages: LintMessage[];
  }>;
  const fatal = result.messages.find((m) => m.fatal);
  if (fatal) throw new Error(`fixture did not parse: ${fatal.message}`);
  const byLine = new Map<number, string[]>();
  for (const { ruleId, line } of result.messages) {
    if (!ruleId?.startsWith('frapp/')) continue;
    byLine.set(line, [...(byLine.get(line) ?? []), ruleId]);
  }
  return byLine;
}

const LOGGER_EXTRA = 'frapp/no-throwable-logger-extra';
const WARN_STACK = 'frapp/no-logger-warn-stack';
const COERCION = 'frapp/no-hand-rolled-error-coercion';
const AUDIT_WRITER = 'frapp/chapter-audit-log-one-writer';

/**
 * One statement per entry, each with the rule it must trip. These are the
 * shapes the deleted `log-throwable-call-sites.spec.ts` and
 * `chapter-audit-log-writer.spec.ts` pinned, plus the ones review found the
 * first selectors missed.
 */
const MUST_FIRE: Array<[rule: string, statement: string]> = [
  [AUDIT_WRITER, "supabase.from('chapter_audit_log').insert({});"],
  [AUDIT_WRITER, 'supabase.from("chapter_audit_log");'],
  [AUDIT_WRITER, 'supabase.from(`chapter_audit_log`);'],
  [AUDIT_WRITER, "supabase.from('chapter_audit_log',);"],
  [AUDIT_WRITER, "supabase?.from('chapter_audit_log');"],
  [LOGGER_EXTRA, "this.logger.error('m', error);"],
  [LOGGER_EXTRA, "logger.warn('m', err);"],
  [LOGGER_EXTRA, "this.logger.error('m', e);"],
  [LOGGER_EXTRA, "this.logger.error('m', reason);"],
  [LOGGER_EXTRA, "this.logger.error('m', updateError);"],
  [LOGGER_EXTRA, "this.logger.error('m', result.reason);"],
  [LOGGER_EXTRA, "this.logger.error('m', result?.reason);"],
  [LOGGER_EXTRA, "this.logger.warn('m', ok ? 'x' : result.reason);"],
  [
    LOGGER_EXTRA,
    "this.logger.error('m', result.reason.stack ?? result.reason);",
  ],
  [LOGGER_EXTRA, "this.logger.error('m', error as Error);"],
  [LOGGER_EXTRA, "this.logger.error('m', error as Error & { code?: string });"],
  [LOGGER_EXTRA, "this.logger.error('m', error as Error | undefined);"],
  [LOGGER_EXTRA, "this.logger.error('m', error as Error[]);"],
  [LOGGER_EXTRA, "this.logger.error('m', String(error as Error));"],
  [LOGGER_EXTRA, "this.logger.error('m', (error as Error).message);"],
  [
    LOGGER_EXTRA,
    "this.logger.error('m', error instanceof Error ? error.stack : error);",
  ],
  [WARN_STACK, "this.logger.warn('m', (error as Error).stack);"],
  [WARN_STACK, "this.logger.warn('m', error?.stack);"],
  [WARN_STACK, "logger.warn('m', `at ${error.stack}`);"],
  [COERCION, 'v = error instanceof Error ? error.stack : String(error);'],
  [COERCION, 'v = err instanceof Error ? err.message : String(err);'],
  [
    COERCION,
    'v = r.reason instanceof Error ? r.reason.message : String(r.reason);',
  ],
  [
    COERCION,
    'v = error instanceof Error ? (error.stack ?? error.message) : String(error);',
  ],
  [
    COERCION,
    'v = `failed: ${error instanceof Error ? error.message : error}`;',
  ],
  [
    COERCION,
    'v = err instanceof Error ? err.message : String(err).slice(0, 200);',
  ],
  [
    COERCION,
    "v = err instanceof Error ? err.message : String(err) + ' (non-Error)';",
  ],
  [COERCION, "v = err instanceof Error ? err.message : err || 'unknown';"],
  [COERCION, "v = error instanceof Error ? error.message : error ?? 'x';"],
  [COERCION, 'v = error instanceof Error ? error.message : (error as string);'],
];

/** Legitimate shapes the bans must leave alone. */
const MUST_PASS: string[] = [
  "supabase.channel('x').on('postgres_changes', { table: 'chapter_audit_log' }, cb);",
  "supabase.from('chapter_audit_log_view');",
  "this.logger.error('m', (error as Error).stack);",
  "this.logger.error('m', error.stack);",
  "this.logger.error('m', { code: 'x' });",
  "this.logger.error('m', `failed: ${String(error)}`);",
  "this.logger.error('m', JSON.stringify(result));",
  "this.logger.error('m', result.reason.message);",
  "this.logger.warn('m', 'SomeContext');",
  "this.logger.log('m', error);",
  "v = error instanceof Error ? error.message : 'unknown error';",
  'v = error instanceof Error ? error.name : String(error);',
];

/** Wrap statements one per line in a method, returning each one's line. */
function fixture(statements: string[]): { text: string; lineOf: number[] } {
  const head = [
    'declare const supabase: any;',
    'declare const logger: any;',
    'declare const cb: any;',
    'declare const ok: boolean;',
    'export class Fixture {',
    '  private readonly logger: any;',
    '  run(error: any, err: any, e: any, reason: any, updateError: any, result: any, r: any): unknown {',
    '    let v: unknown;',
  ];
  const tail = ['    return v;', '  }', '}', ''];
  return {
    text: [...head, ...statements.map((s) => `    ${s}`), ...tail].join('\n'),
    lineOf: statements.map((_, i) => head.length + i + 1),
  };
}

describe('frapp/* lint bans still fire (#3269)', () => {
  // One lint run per fixture: typed linting costs seconds to start.
  jest.setTimeout(120_000);

  it('reports every banned shape under the rule that owns it', () => {
    const { text, lineOf } = fixture(
      MUST_FIRE.map(([, statement]) => statement),
    );
    const reports = frappReports(text);
    const missed = MUST_FIRE.filter(
      ([rule], i) => !(reports.get(lineOf[i]) ?? []).includes(rule),
    ).map(([rule, statement]) => `${rule}: ${statement}`);
    expect(missed).toEqual([]);
  });

  it('leaves the legitimate shapes alone', () => {
    const { text, lineOf } = fixture(MUST_PASS);
    const reports = frappReports(text);
    const flagged = MUST_PASS.flatMap((statement, i) => {
      const rules = reports.get(lineOf[i]);
      return rules ? [`${statement} (${rules.join(', ')})`] : [];
    });
    expect(flagged).toEqual([]);
  });

  it("matches the audit-log repository's own writes once its exemption is lifted", () => {
    // The equality the deleted spec asserted: the one real writer must still
    // match, or a renamed table or a reworded selector leaves the ban inert.
    const repository = readFileSync(
      join(
        API_ROOT,
        'src/infrastructure/supabase/repositories/supabase-chapter-audit-log.repository.ts',
      ),
      'utf8',
    );
    const rules = [...frappReports(repository).values()].flat();
    expect(rules).toContain(AUDIT_WRITER);
  });
});
