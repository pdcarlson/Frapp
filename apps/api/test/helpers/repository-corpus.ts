import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The repository corpus the coverage ledgers measure themselves against.
 *
 * There is one right answer to "which files are repositories", and it used to
 * be written twice with two different answers. `tenant-scope-coverage.spec.ts`
 * walked `apps/api/src` recursively; `no-as-never.spec.ts` read its own
 * directory and filtered on a `supabase-` filename prefix, which reached 38 of
 * the 40 and silently exempted the two module-local ones
 * (`modules/scheduled-jobs`, `modules/chat-push-worker`) from the write-typing
 * rule the skill states for every repository.
 *
 * A guard whose discovery excludes part of what it guards is a proof that
 * cannot fail (`spec/engineering.md` § Changing existing code), so the walk
 * lives here and both ledgers import it. Adding a repository anywhere under
 * `apps/api/src` now joins both denominators at once, which is the property
 * neither spec could give itself.
 */

/** `apps/api/src`, resolved from this helper rather than from each caller. */
export const REPOSITORY_SRC_ROOT = join(__dirname, '..', '..', 'src');

export interface RepositoryFile {
  fileName: string;
  fullPath: string;
}

/**
 * Every `*.repository.ts` under `dir`, sorted by basename.
 *
 * Not the directory and not a filename prefix: a repository is a repository
 * wherever it lives, and both ledgers key on the basename (each asserts that
 * basenames stay unique for exactly that reason).
 */
export function collectRepositories(
  dir: string = REPOSITORY_SRC_ROOT,
): RepositoryFile[] {
  const out: RepositoryFile[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const fullPath = join(dir, name);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      out.push(...collectRepositories(fullPath));
    } else if (st.isFile() && name.endsWith('.repository.ts')) {
      out.push({ fileName: name, fullPath });
    }
  }
  return out.sort((a, b) => a.fileName.localeCompare(b.fileName));
}
