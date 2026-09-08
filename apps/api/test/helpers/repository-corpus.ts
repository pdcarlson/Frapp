import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The repository corpus both coverage ledgers measure themselves against —
 * `tenant-scope-coverage.spec.ts` and `no-as-never.spec.ts`.
 *
 * A repository is a `*.repository.ts` anywhere under `apps/api/src`, never a
 * directory or a filename prefix: the module-local ones
 * (`modules/scheduled-jobs`, `modules/chat-push-worker`) are repositories and
 * belong in both denominators. Discovery lives here so the two ledgers cannot
 * come to disagree about what they are counting — a guard whose discovery
 * excludes part of what it guards is a proof that cannot fail
 * (`spec/engineering.md` § Changing existing code).
 */

interface RepositoryFile {
  fileName: string;
  fullPath: string;
}

/**
 * Pinned so a repository cannot join the tree without both ledgers noticing.
 * One home for the number: raise it here, not in either spec.
 */
export const EXPECTED_REPOSITORY_COUNT = 40;

/** `apps/api/src` — the one root both ledgers walk, and what paths report against. */
export const REPOSITORY_SRC_ROOT = join(__dirname, '..', '..', 'src');

/** Every `*.repository.ts` under `apps/api/src`, sorted by basename. */
export function collectRepositories(
  dir: string = REPOSITORY_SRC_ROOT,
): RepositoryFile[] {
  const out: RepositoryFile[] = [];
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      out.push(...collectRepositories(fullPath));
    } else if (name.endsWith('.repository.ts')) {
      out.push({ fileName: name, fullPath });
    }
  }
  return out.sort((a, b) => a.fileName.localeCompare(b.fileName));
}
