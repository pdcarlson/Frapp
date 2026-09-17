import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

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
 * The denominator both ledgers measure against, pinned so a repository cannot
 * join the tree without both noticing. One home for *this* number — raise it
 * here, not in either spec. `tenant-scope-coverage.spec.ts` separately pins
 * how many of them are covered, which is a different fact and moves with the
 * spec you write.
 */
export const EXPECTED_REPOSITORY_COUNT = 43;

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
