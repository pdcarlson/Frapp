import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { REPOSITORY_SRC_ROOT as SRC_ROOT } from '#test/helpers/repository-corpus';

/**
 * Names that, as a Nest Logger.error/warn *second argument*, were the
 * PostgREST `{ code, message, details, hint }` leak #1669 named. Nest's
 * ConsoleLogger `util.inspect`s a non-stack extra argument, so `details`
 * (row values) reached plaintext logs.
 *
 * `error as Error` is a type lie wherever a raw PostgREST record can still
 * arrive (the repositories wrap theirs in `SupabaseQueryError` since #1264),
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
 * (#2460): `x instanceof Error ? x.stack : String(x)`, with `.message` or
 * `(x.stack ?? x.message)` for the true branch, and `String(x)` or the bare
 * `x` (interpolated into a template) for the false one. Any throwable that is
 * not an `Error` takes the false branch: a raw PostgREST record (what every
 * repository threw before #1264 wrapped them in `SupabaseQueryError`), a
 * Realtime `err`, an `allSettled` reason. Either fallback renders it as the
 * literal `[object Object]`, on exactly the paths where the cause is what an
 * operator needs. `\s` spans newlines, so a Prettier-wrapped ternary matches
 * too. A coercion spelled some other way (a helper, a `typeof` check) is not
 * caught; this pins the shapes the codebase actually grew.
 */
const HAND_ROLLED_COERCION =
  /(\b[\w.]+)\s+instanceof\s+Error\s*\?\s*\(?\s*\1\.(?:stack|message)(?:\s*\?\?\s*\1\.(?:stack|message))?\s*\)?\s*:\s*(?:String\(\s*\1\s*\)|\1(?![\w.]))/g;

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

/**
 * Blank every comment, keeping each newline so reported line numbers hold.
 *
 * Comments are read off the parsed file rather than matched by regex: a regex
 * cannot tell a `//` in `'https://…'` from a comment, and cutting the rest of
 * that line hid whatever logger call or coercion shared it. Every comment is
 * leading or trailing trivia of some token (the end-of-file token included;
 * TypeScript files a comment that shares its line with the token before it as
 * that token's trailing trivia), so walking every token's two ranges finds
 * them all.
 */
function stripComments(src: string): string {
  const chars = src.split('');
  const file = ts.createSourceFile('guard.ts', src, ts.ScriptTarget.Latest);
  const blanked = new Set<number>();
  const blank = (ranges: ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (blanked.has(range.pos)) continue;
      blanked.add(range.pos);
      for (let i = range.pos; i < range.end; i += 1) {
        if (chars[i] !== '\n') chars[i] = ' ';
      }
    }
  };
  const visit = (node: ts.Node): void => {
    blank(ts.getLeadingCommentRanges(src, node.pos));
    blank(ts.getTrailingCommentRanges(src, node.end));
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return chars.join('');
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

  // Assembled, not written out, so #2460's own acceptance grep for the
  // first shape finds product code only.
  const coercion = (x: string, ifError: string, otherwise: string): string =>
    `${x} instanceof Error ? ${ifError} : ${otherwise}`;

  it('the coercion pattern matches every shape it replaced', () => {
    const shapes = [
      coercion('error', 'error.stack', 'String(error)'),
      coercion('err', 'err.message', 'String(err)'),
      coercion(
        'result.reason',
        'result.reason.message',
        'String(result.reason)',
      ),
      coercion('error', '(error.stack ?? error.message)', 'String(error)'),
      `\`failed: \${${coercion('error', 'error.message', 'error')}}\``,
      coercion(
        'cleanupError',
        '\n  cleanupError.message\n ',
        'String(cleanupError)',
      ),
    ];
    for (const shape of shapes) {
      expect(shape.match(HAND_ROLLED_COERCION)).toHaveLength(1);
    }
    for (const unrelated of [
      coercion('error', 'other.message', 'String(error)'),
      coercion('error', 'error.message', 'error.code'),
    ]) {
      expect(unrelated.match(HAND_ROLLED_COERCION)).toBeNull();
    }
  });

  it('strips comments without eating a `//` inside a string', () => {
    const src = [
      `log(\`see https://x.example: \${${coercion('e', 'e.message', 'String(e)')}}\`); // tail`,
      `/* ${coercion('e', 'e.stack', 'String(e)')} */`,
      `// ${coercion('e', 'e.stack', 'String(e)')}`,
    ].join('\n');
    const stripped = stripComments(src);
    expect(stripped.split('\n')).toHaveLength(3);
    expect(stripped).toContain('https://x.example');
    expect(stripped).not.toContain('tail');
    expect(stripped.match(HAND_ROLLED_COERCION)).toHaveLength(1);
  });
});
