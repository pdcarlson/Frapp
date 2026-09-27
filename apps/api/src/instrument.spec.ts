import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * `instrument.ts` must not load any `@nestjs/*` module before `Sentry.init`.
 *
 * SDK v11 instruments `@nestjs/common`'s `@Injectable()` / `@Catch()` by
 * rewriting those files as they load, with hooks `Sentry.init` registers. If
 * anything in `instrument.ts`'s import graph loads `@nestjs/common` first,
 * the decorators stay unrewritten and every middleware, guard, pipe,
 * interceptor and filter span disappears, with no error and every other spec
 * green. That is how the file shipped until #2722: a `Logger` import above
 * `Sentry.init`.
 *
 * Walked statically rather than by booting, because Jest's module registry
 * is not Node's and the SDK's load hooks do not run under it. The walk
 * follows relative imports and `@repo/*` workspace entries; it stops at other
 * packages, which is enough for the failure this guards (`@sentry/nestjs`'s
 * main entry does not load Nest; only its separate `/setup` entry does).
 */

const API_SRC = __dirname;
const REPO_ROOT = resolve(API_SRC, '../../..');
const SPECIFIER =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function resolveModule(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else if (specifier.startsWith('@repo/')) {
    const pkg = specifier.slice('@repo/'.length).split('/')[0];
    base = join(REPO_ROOT, 'packages', pkg, 'src', 'index');
  } else {
    return null;
  }
  for (const candidate of [`${base}.ts`, join(base, 'index.ts'), base]) {
    if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every bare specifier reachable from `entry`, with the file that imports it. */
function reachableSpecifiers(entry: string): Map<string, string> {
  const seen = new Set<string>();
  const found = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      // `import type` is erased at compile time and loads nothing.
      if (/^\s*(?:import|export)\s+type\s/.test(match[0].trimStart())) {
        continue;
      }
      const next = resolveModule(specifier, file);
      if (next) queue.push(next);
      else if (!found.has(specifier)) found.set(specifier, file);
    }
  }
  return found;
}

describe('instrument.ts load order', () => {
  it('loads no @nestjs module before Sentry.init', () => {
    const specifiers = reachableSpecifiers(join(API_SRC, 'instrument.ts'));
    const nest = [...specifiers]
      .filter(([specifier]) => specifier.startsWith('@nestjs/'))
      .map(([specifier, file]) => `${specifier} (from ${file})`);
    expect(nest).toEqual([]);
    // Guards the walk itself: if it stopped resolving imports, the check
    // above would pass on an empty set.
    expect([...specifiers.keys()]).toContain('@sentry/nestjs');
  });
});
