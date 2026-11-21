import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * The repository corpus both coverage ledgers measure themselves against —
 * `tenant-scope-coverage.spec.ts` and `no-as-never.spec.ts`.
 *
 * A repository is a `*.repository.ts` anywhere under `apps/api/src`, never a
 * directory or a filename prefix: one written outside
 * `infrastructure/supabase/repositories/` (as the worker repositories once
 * were, under `modules/`) is still a repository and belongs in both
 * denominators. Discovery lives here so the two ledgers cannot
 * come to disagree about what they are counting — a guard whose discovery
 * excludes part of what it guards is a proof that cannot fail
 * (`spec/engineering.md` § Changing existing code).
 */

interface RepositoryFile {
  fileName: string;
  fullPath: string;
}

/**
 * The fewest repositories both ledgers may find: a floor, so a new repository
 * needs no edit here. Lower it only when repositories are really removed.
 *
 * A floor alone stops noticing a walker that loses files once the tree grows
 * past it, so `tenant-scope-coverage.spec.ts` also checks the walker against
 * `git ls-files`: a committed repository it misses fails there, whatever the
 * count.
 *
 * It used to be the exact count, which every PR adding a repository bumped,
 * so any two such PRs open at once conflicted on this line (2026-11-12, #4558).
 * The ledgers themselves already notice a new repository: the tenant-scope
 * ledger fails until it has a spec or a backlog reason, and every file is
 * checked by `no-as-never.spec.ts`.
 */
export const MIN_REPOSITORY_COUNT = 71;

/** `apps/api/src` — the one root both ledgers walk, and what paths report against. */
export const REPOSITORY_SRC_ROOT = join(__dirname, '..', '..', 'src');

/**
 * Every file under `apps/api/src` whose basename `accept` returns true for,
 * sorted by full path.
 *
 * The one walk. Each ledger says what it counts by passing a predicate rather
 * than re-deriving the traversal, for the reason stated above: a second walker
 * means two definitions of what is in the tree, and the day one learns to skip
 * a directory the other keeps counting it.
 *
 * `withFileTypes` rather than `statSync`: it does not follow symlinks, so a
 * stale or circular link under `src` cannot turn a ledger into an `ENOENT` or
 * an unbounded recursion.
 */
export function collectApiSources(
  accept: (fileName: string) => boolean,
  dir: string = REPOSITORY_SRC_ROOT,
): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectApiSources(accept, fullPath));
    } else if (entry.isFile() && accept(entry.name)) {
      out.push(fullPath);
    }
  }
  return out.sort();
}

/** Every `*.repository.ts` under `apps/api/src`, sorted by basename. */
export function collectRepositories(
  dir: string = REPOSITORY_SRC_ROOT,
): RepositoryFile[] {
  return collectApiSources((name) => name.endsWith('.repository.ts'), dir)
    .map((fullPath) => ({ fileName: basename(fullPath), fullPath }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}
