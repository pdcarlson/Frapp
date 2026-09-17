import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  REPOSITORY_SRC_ROOT as SRC_ROOT,
  collectApiSources,
} from '#test/helpers/repository-corpus';

/**
 * One writer for `chapter_audit_log` (#2167).
 *
 * `ChapterAuditLogService.record` owns the row shape — `scope`,
 * `member_visible`, the `target_id` / `diff` defaults, and the log-then-rethrow
 * that makes a failed audit fail its request. Three services used to insert
 * inline beside it, which is the parallel path `AGENTS.md` § Tech debt protocol
 * forbids ("a cutover deletes what it replaces"). They were moved onto
 * `record`; this spec is what keeps a fourth from appearing, because the
 * property that matters is not "those three were fixed once" but "nothing
 * writes this table except the repository behind that service".
 *
 * `spec/engineering.md` § Changing existing code asks for a proof that could
 * actually fail, and the way this species of spec fails is by matching nothing
 * at all — a renamed table, a reworded regex, a walk that quietly stops
 * descending, and `offenders` is empty forever. So the allowlist is asserted
 * *positively*: the files that are supposed to match must still match, which
 * is what makes an empty `offenders` mean something.
 *
 * Known gaps, stated rather than left sharp — this is a text scan, not a type
 * checker:
 *
 *  - A table name reached indirectly (`const t = 'chapter_audit_log';
 *    client.from(t)`), or built by concatenation.
 *  - A raw-SQL insert through an RPC.
 *
 * Widen it when one of those turns up live; never narrow it. Adding a file to
 * `ALLOWED` is not the remedy for a new inline writer — injecting
 * `ChapterAuditLogService` is.
 */

/**
 * `.from('chapter_audit_log')` in every spelling the toolchain can produce.
 *
 * All three quote styles, because nothing in `apps/api/eslint.config.mjs`
 * forces one and Prettier does not rewrite a substitution-free template
 * literal; and an optional trailing comma before the paren, because Prettier
 * wraps a long call onto its own line and adds one. Matching only `'` and `"`
 * with the paren tight against the quote is the vacuously-green form this
 * pattern invites.
 *
 * Anchored to the PostgREST entry point, so the table name in prose, in a
 * Realtime channel's `table:` filter (`ChatBridgeWorkerService` subscribes to
 * this table and writes nothing), or in a `Database` type map is not matched.
 */
const FROM_AUDIT_LOG = /\.from\(\s*['"`]chapter_audit_log['"`]\s*,?\s*\)/;

/**
 * The files that may reach the table directly.
 *
 * `supabase-chapter-audit-log.repository.ts` is the writer behind
 * `ChapterAuditLogService`; `database.types.insert-check.ts` is the
 * compile-only proof that a typed insert is accepted and a mistyped one
 * rejected, and performs no runtime write (`void`).
 */
const ALLOWED = [
  'infrastructure/supabase/database.types.insert-check.ts',
  'infrastructure/supabase/repositories/supabase-chapter-audit-log.repository.ts',
];

/** Repo-relative, forward-slashed, the way `ALLOWED` spells them. */
function toRepoPath(fullPath: string): string {
  return relative(SRC_ROOT, fullPath).split('\\').join('/');
}

describe('chapter_audit_log has one writer', () => {
  // The same walk `no-as-never.spec.ts` and `tenant-scope-coverage.spec.ts`
  // measure against, so the three ledgers cannot come to disagree about what
  // is in the tree.
  const sources = collectApiSources(
    (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
  );
  const matches = sources.filter((fullPath) =>
    FROM_AUDIT_LOG.test(readFileSync(fullPath, 'utf8')),
  );

  it('is reached directly only by its repository and the compile-only check', () => {
    // Equality, not "no offenders": this fails both when a file is added to
    // the writers and when the regex, the walk or the table name stops
    // matching the writers that exist — the false-clean this spec would
    // otherwise be prone to.
    expect(matches.map(toRepoPath).sort()).toEqual([...ALLOWED].sort());
  });

  it('walks the whole of apps/api/src', () => {
    // A walk that silently stopped descending would make the assertion above
    // pass for the wrong reason. The equality catches a subtree containing an
    // ALLOWED file; this catches the rest, per top-level directory rather than
    // by a total that any one subtree can hide inside.
    expect(sources.length).toBeGreaterThan(300);
    const topLevel = new Set(sources.map((p) => toRepoPath(p).split('/')[0]));
    expect([...topLevel].sort()).toEqual(
      expect.arrayContaining([
        'application',
        'domain',
        'infrastructure',
        'interface',
        'modules',
      ]),
    );
  });
});
