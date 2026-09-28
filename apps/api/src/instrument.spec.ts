import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * `instrument.ts` must run `Sentry.init` before anything loads `@nestjs/*`.
 *
 * SDK v11 instruments `@nestjs/common`'s `@Injectable()` / `@Catch()` by
 * rewriting those files as they load, with hooks `Sentry.init` registers. If
 * `@nestjs/common` loads first, the decorators stay unrewritten and every
 * middleware, guard, pipe, interceptor and filter span disappears, with no
 * error and every other spec green. That is how the API shipped until #2722:
 * a `Logger` import above `Sentry.init`.
 *
 * Two halves, both needed: `instrument.ts`'s own graph must not reach Nest,
 * and `main.ts` must import `./instrument` before anything else.
 */

const API_ROOT = join(__dirname, '..');

/** Every `@nestjs/*` package the API depends on, from its manifest. */
function nestPackages(): string[] {
  const pkg = JSON.parse(
    readFileSync(join(API_ROOT, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
    (name) => name.startsWith('@nestjs/'),
  );
}

describe('instrument.ts load order', () => {
  const previousDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    if (previousDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previousDsn;
  });

  it('loads no @nestjs module, directly or transitively', () => {
    // Loaded for real rather than parsed, so `require`, path aliases,
    // workspace packages and third-party modules are all covered: any of
    // them reaching a Nest package hits a mock that throws. No DSN, so
    // `Sentry.init` is skipped and nothing global is installed.
    delete process.env.SENTRY_DSN;
    const packages = nestPackages();
    expect(packages).toContain('@nestjs/common');

    const loaded: string[] = [];
    jest.isolateModules(() => {
      for (const name of packages) {
        // `virtual`: some, like `@nestjs/cli`, ship no resolvable entry.
        jest.doMock(
          name,
          () => {
            loaded.push(name);
            throw new Error(`${name} loaded before Sentry.init`);
          },
          { virtual: true },
        );
      }
      jest.requireActual('./instrument');
    });
    expect(loaded).toEqual([]);
  });

  it('is the first module main.ts imports', () => {
    // A Nest import above it would load `@nestjs/common` before
    // `Sentry.init` just the same. `preProcessFile` lists imports in source
    // order, `require` calls included.
    const source = readFileSync(join(__dirname, 'main.ts'), 'utf8');
    const { importedFiles } = ts.preProcessFile(source, true, true);
    expect(importedFiles[0]?.fileName).toBe('./instrument');
  });
});
