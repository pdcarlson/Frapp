import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Every Nest module lives under `src/modules/` (`docs/guides/api-architecture.md`
 * § 1); `app.module.ts` is the one root exception. A `@Module(` declared in
 * `infrastructure/`, `application/` or anywhere else fails here (#4153).
 */
const SRC = path.resolve(__dirname, '..');
const MODULES = path.join(SRC, 'modules');
const ROOT_MODULE = path.join(SRC, 'app.module.ts');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

describe('Nest module placement', () => {
  it('declares every @Module under src/modules/ (or the root app.module.ts)', () => {
    const misplaced = sourceFiles(SRC)
      .filter(
        (file) => file !== ROOT_MODULE && !file.startsWith(MODULES + path.sep),
      )
      .filter((file) => /@Module\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));
    expect(misplaced).toEqual([]);
  });

  it('still finds the modules it guards', () => {
    const declared = sourceFiles(MODULES).filter((file) =>
      /@Module\(/.test(fs.readFileSync(file, 'utf8')),
    );
    expect(declared.length).toBeGreaterThan(50);
  });
});
