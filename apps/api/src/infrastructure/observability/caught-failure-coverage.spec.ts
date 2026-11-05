import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The rule (`spec/behavior/observability.md` § Error Tracking): a caught
 * failure that drops work reports to Sentry. Sentry does not capture console
 * output, so a catch that logs at error level and does not rethrow is
 * invisible to every alert (#3379, #3364). Such a catch calls
 * `reportCaughtFailure`, which logs and reports in one step.
 *
 * So outside this folder, an error-level log call (`logger.error(…)`, or
 * `logThrowable(…, 'error', …)`) is a failure unless the line above it says
 * why Sentry already hears about it, or why it must not:
 *
 *     // caught-failure-exempt: rethrown; AllExceptionsFilter reports the 5xx
 *
 * The reason is the allowlist. Keep it at the call, where a reviewer reading
 * the catch can check it. Warn-level calls are not checked: a warning is a
 * degradation the caller absorbs, and most of those are not worth an alert.
 */
const SRC = join(__dirname, '..', '..');
const OWN_FOLDER = join('infrastructure', 'observability');

/** Entry points that run outside the Nest app, where Sentry is never initialized. */
const STANDALONE_SCRIPTS = new Set([
  'export-openapi.ts',
  'backfill-discord-mention-tokens.ts',
]);

const ERROR_LOG = /\.error\(|\blogThrowable\(\s*[\w.]+\s*,\s*'error'/g;
const EXEMPT = /\/\/\s*caught-failure-exempt:\s*\S/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

/** Lines above `index`, skipping blank lines and the call's own preamble. */
function precedingComment(lines: string[], index: number): string {
  const above: string[] = [];
  for (let i = index - 1; i >= 0 && above.length < 6; i -= 1) {
    const line = lines[i]?.trim() ?? '';
    if (!line.startsWith('//')) break;
    above.unshift(line);
  }
  return above.join(' ');
}

function findUnreported(): string[] {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel.startsWith(OWN_FOLDER + sep) || STANDALONE_SCRIPTS.has(rel)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const match of text.matchAll(ERROR_LOG)) {
      const index = text.slice(0, match.index).split('\n').length - 1;
      const line = lines[index] ?? '';
      // `.error(` on something that is not a logger (`res.error(`) is rare
      // enough to exempt by comment like any other case.
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      if (EXEMPT.test(line) || EXEMPT.test(precedingComment(lines, index))) {
        continue;
      }
      offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
    }
  }
  return offenders;
}

describe('caught failures reach Sentry', () => {
  it('has no error-level log call without reportCaughtFailure or an exemption', () => {
    // Each line is a catch that logs at error level and never reaches Sentry.
    // Use reportCaughtFailure there, or, if the failure is rethrown or
    // reported nearby, say so in a `// caught-failure-exempt:` comment.
    expect(findUnreported()).toEqual([]);
  });

  it('finds a log-only catch and honors an exemption', () => {
    // Proves the scan still bites (a regex that matched nothing would pass
    // the test above forever).
    const probe = [
      'try { await run(); } catch (error) {',
      '  // an ordinary comment is not an exemption',
      "  logThrowable(this.logger, 'error', 'run failed', error);",
      '}',
      '// caught-failure-exempt: rethrown below',
      "this.logger.error('x');",
    ].join('\n');
    const hits = [...probe.matchAll(ERROR_LOG)].map(
      (m) => probe.slice(0, m.index).split('\n').length,
    );
    expect(hits).toEqual([3, 6]);
    const lines = probe.split('\n');
    expect(EXEMPT.test(precedingComment(lines, 2))).toBe(false);
    expect(EXEMPT.test(precedingComment(lines, 5))).toBe(true);
  });
});
