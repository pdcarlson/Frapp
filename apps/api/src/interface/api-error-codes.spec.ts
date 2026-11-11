import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CLIENT_CONTRACT_ERROR_CODES,
  MEMBER_CAUSED_ERROR_CODES,
} from '@repo/observability';
import * as validation from '@repo/validation';

/**
 * Every machine `code` the API puts on a refusal is classified in
 * `@repo/observability`'s `api-error-codes.ts` (#4096), and every code there
 * is one the API still throws.
 *
 * The clients' query-error reporters send a client-contract code at `error`
 * level and treat anything else as member-caused, so an unclassified code
 * would be quietly read as member-caused. This scan makes adding a code a
 * decision instead.
 *
 * It is a syntax scan of `new …Exception({ … })` objects under `src`, outside
 * specs. Inside one, a code is a dotted lowercase string literal
 * (`'chapter.context.required'`, the shape every refusal code has), or an
 * identifier ending `_CODE` that `@repo/validation` exports. It cannot see a
 * code built by a helper, held in a variable of another name, or written
 * without a dot.
 */

const SRC = path.resolve(__dirname, '..');
const CODE_LITERAL = /['"]([a-z_]+(?:\.[a-z_]+)+)['"]/g;
const CODE_CONSTANT = /\b([A-Z][A-Z0-9_]*_CODE)\b/g;
const EXCEPTION_OBJECT = /new\s+\w*Exception\(\s*\{/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

/** The text of the object literal opening at `start` (its `{`). */
function objectAt(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

function thrownCodes(): Map<string, string> {
  const constants = validation as unknown as Record<string, unknown>;
  const found = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(EXCEPTION_OBJECT)) {
      const object = objectAt(source, match.index + match[0].length - 1);
      const where = path.relative(SRC, file);
      for (const [, code] of object.matchAll(CODE_LITERAL)) {
        found.set(code, where);
      }
      for (const [, name] of object.matchAll(CODE_CONSTANT)) {
        const value = constants[name];
        if (typeof value === 'string') found.set(value, where);
      }
    }
  }
  return found;
}

describe('API error codes are classified (#4096)', () => {
  const thrown = thrownCodes();
  const classified = new Set<string>([
    ...CLIENT_CONTRACT_ERROR_CODES,
    ...MEMBER_CAUSED_ERROR_CODES,
  ]);

  it('finds the codes it is meant to see', () => {
    // A scan that silently finds nothing would pass everything below.
    expect(thrown.get('chapter.context.required')).toBe(
      path.join('interface', 'guards', 'chapter.guard.ts'),
    );
    expect(thrown.has('request.validation_failed')).toBe(true);
    expect(thrown.has('legal.acceptance_required')).toBe(true);
  });

  it('classifies every code the API throws', () => {
    const unclassified = [...thrown]
      .filter(([code]) => !classified.has(code))
      .map(([code, where]) => `${code} (${where})`);
    expect(unclassified).toEqual([]);
  });

  it('lists no code the API no longer throws', () => {
    expect([...classified].filter((code) => !thrown.has(code))).toEqual([]);
  });
});
