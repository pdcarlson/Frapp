import { collectApiSources } from './repository-corpus';

/**
 * The DTO corpus the DTO guards measure themselves against —
 * `dto-constraint-coverage.spec.ts` and `boolean-dto-fields.spec.ts`. One walk,
 * so the two cannot come to disagree about which classes exist.
 */

export interface DtoClass {
  new (...args: never[]): object;
  name: string;
}

/**
 * Every class exported from a `*.dto.ts` anywhere under `apps/api/src`.
 *
 * Discovered from disk rather than listed by hand: a new `*.dto.ts` is covered
 * the moment it lands. It walks all of `src` through `collectApiSources`, not
 * just `interface/dtos`, so a DTO written anywhere else is audited too; a
 * guard whose discovery excludes part of what it guards cannot fail.
 */
export function loadDtoClasses(): DtoClass[] {
  const classes: DtoClass[] = [];

  for (const file of collectApiSources((name) => name.endsWith('.dto.ts'))) {
    // Synchronous require, as in test/ai-evals/harness/registry.ts: simpler
    // than `import()`, which stays a true dynamic import under ts-jest.
    // Extension stripped so Jest's resolver picks the module up normally.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file.replace(/\.ts$/, '')) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (
        typeof exported === 'function' &&
        /^\s*class\s/.test(exported.toString())
      ) {
        classes.push(exported as DtoClass);
      }
    }
  }
  return classes;
}
