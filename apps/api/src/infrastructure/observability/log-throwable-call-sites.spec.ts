import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPOSITORY_SRC_ROOT as SRC_ROOT } from '#test/helpers/repository-corpus';

/**
 * Names that, as a Nest Logger.error/warn *second argument*, were the
 * PostgREST `{ code, message, details, hint }` leak #1669 named. Nest's
 * ConsoleLogger `util.inspect`s a non-stack extra argument, so `details`
 * (row values) reached plaintext logs.
 *
 * `error as Error` is a type lie: repositories still throw plain objects,
 * and inspect prints `details`. Catch bindings named `err` and
 * `Promise.allSettled` `reason` are the same hole. Vendor SDK failures
 * (PostHog, Resend) and Realtime `removeChannel` errors go through
 * `logThrowable` as well so a non-Error extra never reaches inspect.
 *
 * A second-arg *ternary* that falls back to the throwable (`error instanceof
 * Error ? error.stack : error`) is the same inspect leak (#2114): the false
 * branch is that object. `: String(error)` is not — that prints
 * `[object Object]`.
 */
const POSTGREST_LOG_ARG = new Set([
  'error',
  'updateError',
  'workflowError',
  'duesError',
  'serviceError',
  'pointsError',
  'auditError',
  'insertError',
  'channelError',
  'lookupError',
  'releaseError',
]);

const SKIP = new Set(['log-throwable.ts']);

/**
 * The hand-rolled coercion `logThrowable` and `toReportableError` replace
 * (#2460): `x instanceof Error ? x.stack : String(x)`, or `.message` in place
 * of `.stack`. A repository throws a plain `{ code, message, details, hint }`
 * object, not an `Error`, so the fallback branch is the one that runs, and
 * `String()` of it is the literal `[object Object]` — on exactly the paths
 * where the cause is what an operator needs. `\s` spans newlines, so a
 * Prettier-wrapped ternary matches too.
 */
const HAND_ROLLED_COERCION =
  /(\b[\w.]+)\s+instanceof\s+Error\s*\?\s*\1\.(?:stack|message)\s*:\s*String\(\s*\1\s*\)/g;

/**
 * `src/domain/` may not import `infrastructure/observability`
 * (`api-domain-is-innermost`), and its one coercion formats `JSON.parse`'s
 * `SyntaxError`, which is always an `Error`. A domain logger does not exist.
 */
const COERCION_ALLOWED_DIR = /^domain\//;

function collectSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSrcFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out.sort();
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function loggerCalls(
  src: string,
): Array<{ level: string; line: number; args: string[] }> {
  const results: Array<{ level: string; line: number; args: string[] }> = [];
  const re = /logger\.(error|warn)\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const start = match.index;
    const level = match[1];
    let j = match.index + match[0].length;
    let depth = 1;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      j += 1;
    }
    const argsSrc = src.slice(match.index + match[0].length, j - 1);
    const parts: string[] = [];
    let d = 0;
    let last = 0;
    for (let idx = 0; idx < argsSrc.length; idx += 1) {
      const ch = argsSrc[idx];
      if ('({['.includes(ch)) d += 1;
      else if (')}]'.includes(ch)) d -= 1;
      else if (ch === ',' && d === 0) {
        parts.push(argsSrc.slice(last, idx).trim());
        last = idx + 1;
      }
    }
    parts.push(argsSrc.slice(last).trim());
    results.push({
      level,
      line: src.slice(0, start).split('\n').length,
      args: parts,
    });
    re.lastIndex = j;
  }
  return results;
}

/**
 * True when the second Logger argument is a throwable (or a type-lied
 * PostgREST body) rather than a string / structured context object.
 */
function isThrowableExtra(second: string): boolean {
  if (!second) return false;
  if (second.startsWith('{')) return false;
  if (
    second.startsWith('`') ||
    second.startsWith("'") ||
    second.startsWith('"')
  ) {
    return false;
  }
  if (second.startsWith('JSON.stringify')) return false;
  if (/\.stack\s*$/.test(second)) return false;
  if (/\bas\s+Error\b/.test(second)) return true;
  if (/:\s*(?:error|err|e|reason)\s*$/.test(second)) return true;
  if (second === 'result.reason' || /\.reason$/.test(second)) return true;
  if (POSTGREST_LOG_ARG.has(second)) return true;
  if (/^[A-Za-z][A-Za-z0-9]*Error$/.test(second)) return true;
  if (/^(err|error|e|reason)$/.test(second)) return true;
  return false;
}

describe('PostgREST errors are not a Nest Logger second argument (#1669)', () => {
  const files = collectSrcFiles(SRC_ROOT);

  it('does not pass a throwable object as logger.error/warn extra arg', () => {
    const hits: string[] = [];
    for (const fullPath of files) {
      const fileName = fullPath.split('/').pop() ?? fullPath;
      if (SKIP.has(fileName)) continue;
      const src = stripComments(readFileSync(fullPath, 'utf8'));
      for (const call of loggerCalls(src)) {
        if (call.args.length < 2) continue;
        const second = call.args[1].replace(/\s+/g, ' ').trim();
        if (!isThrowableExtra(second)) continue;
        hits.push(
          `${relative(SRC_ROOT, fullPath)}:${call.line} logger.${call.level}(..., ${second})`,
        );
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('a throwable is described by its owner, not hand-rolled (#2460)', () => {
  const files = collectSrcFiles(SRC_ROOT);

  it('never coerces with `x instanceof Error ? x.stack|message : String(x)`', () => {
    const hits: string[] = [];
    for (const fullPath of files) {
      const rel = relative(SRC_ROOT, fullPath);
      if (COERCION_ALLOWED_DIR.test(rel)) continue;
      const fileName = fullPath.split('/').pop() ?? fullPath;
      if (SKIP.has(fileName)) continue;
      const src = stripComments(readFileSync(fullPath, 'utf8'));
      for (const match of src.matchAll(HAND_ROLLED_COERCION)) {
        const line = src.slice(0, match.index).split('\n').length;
        hits.push(
          `${rel}:${line} ${match[0].replace(/\s+/g, ' ')} — use logThrowable() for a log line, toReportableError(x).message for any other string`,
        );
      }
    }
    expect(hits).toEqual([]);
  });

  it('never hands logger.warn a stack: ConsoleLogger reads it as the context', () => {
    const hits: string[] = [];
    for (const fullPath of files) {
      const fileName = fullPath.split('/').pop() ?? fullPath;
      if (SKIP.has(fileName)) continue;
      const src = stripComments(readFileSync(fullPath, 'utf8'));
      for (const call of loggerCalls(src)) {
        if (call.level !== 'warn' || call.args.length < 2) continue;
        if (!/\.stack\b/.test(call.args[1])) continue;
        hits.push(
          `${relative(SRC_ROOT, fullPath)}:${call.line} logger.warn(..., ${call.args[1].replace(/\s+/g, ' ')})`,
        );
      }
    }
    expect(hits).toEqual([]);
  });

  it('the coercion pattern matches every shape it replaced', () => {
    const shapes = [
      'error instanceof Error ? error.stack : String(error)',
      'err instanceof Error ? err.message : String(err)',
      'result.reason instanceof Error ? result.reason.message : String(result.reason)',
      'cleanupError instanceof Error\n  ? cleanupError.message\n  : String(cleanupError)',
    ];
    for (const shape of shapes) {
      expect(shape.match(HAND_ROLLED_COERCION)).toHaveLength(1);
    }
    expect(
      'error instanceof Error ? other.message : String(error)'.match(
        HAND_ROLLED_COERCION,
      ),
    ).toBeNull();
  });
});
