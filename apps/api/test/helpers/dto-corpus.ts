import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The DTO corpus the DTO guards measure themselves against —
 * `dto-constraint-coverage.spec.ts` and `boolean-dto-fields.spec.ts`. One walk,
 * so the two cannot come to disagree about which classes exist.
 */

export interface DtoClass {
  new (...args: never[]): object;
  name: string;
}

/** `apps/api/src/interface/dtos`. */
const DTO_ROOT = join(__dirname, '..', '..', 'src', 'interface', 'dtos');

/**
 * Every class exported from a `*.dto.ts` under the DTO directory.
 *
 * Discovered from disk rather than listed by hand: a new `*.dto.ts` is covered
 * the moment it lands. Recursive so a reorganisation into `dtos/<domain>/`
 * subfolders keeps every DTO audited; a flat read would quietly stop covering
 * the moved files while still finding enough classes to clear a floor.
 */
export function loadDtoClasses(): DtoClass[] {
  const classes: DtoClass[] = [];

  for (const file of readdirSync(DTO_ROOT, { recursive: true })
    .map(String)
    .sort()) {
    if (!file.endsWith('.dto.ts')) continue;
    // Synchronous require, as in test/ai-evals/harness/registry.ts: simpler
    // than `import()`, which stays a true dynamic import under ts-jest.
    // Extension stripped so Jest's resolver picks the module up normally.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(join(DTO_ROOT, file.replace(/\.ts$/, ''))) as Record<
      string,
      unknown
    >;
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
