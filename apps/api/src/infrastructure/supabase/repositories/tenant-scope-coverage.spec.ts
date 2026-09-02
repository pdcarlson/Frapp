import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Coverage ledger for the tenant-scope specs.
 *
 * The point of a ledger rather than a count is that "33 repositories, 0 direct
 * behavioural tests" was true for a long time without anybody being able to see
 * it from inside the code. A new repository added without a tenant-scope spec
 * now fails here, and deferring one is a line in `TENANT_SCOPE_BACKLOG` with a
 * reason — a decision somebody made, not a gap that accumulated.
 *
 * Discovery is a recursive walk of `apps/api/src` for `*.repository.ts`, not
 * this directory and not a `supabase-` filename prefix. Module-local
 * repositories (`modules/scheduled-jobs`, `modules/chat-push-worker`) are in
 * the denominator. The sibling `*.repository.spec.ts` is the spec, wherever
 * the implementation lives.
 *
 * This is not a quality gate on the specs themselves; a spec that exists but
 * asserts nothing satisfies it. What stops that is `tenant-scope.harness.spec.ts`,
 * which proves the harness those specs use can still fail.
 */

const SRC_ROOT = join(__dirname, '../../..');

interface RepositoryFile {
  fileName: string;
  fullPath: string;
}

function collectRepositories(dir: string): RepositoryFile[] {
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

/**
 * Repositories deliberately not covered in this pass, each with the reason.
 * Everything here is either structurally untenanted or outside the
 * security/dues/points and query-key-migration scope that was prioritised.
 *
 * Moving a line out of this list means writing the spec; deleting a line
 * without writing one puts the repository back in the failing set.
 *
 * Keys are basenames — unique across `apps/api/src` today. The uniqueness
 * assertion below fails if a second `foo.repository.ts` appears.
 */
const TENANT_SCOPE_BACKLOG: Record<string, string> = {
  'supabase-user.repository.ts':
    'users is global — identity exists before and across chapters; membership lives in members.',
  'supabase-user-settings.repository.ts':
    'user_settings is per-user and chapter-independent.',
  'supabase-push-token.repository.ts':
    'push_tokens is per-user/device; a token has no chapter.',
  'supabase-stripe-webhook-event.repository.ts':
    'stripe_webhook_events is a global idempotency ledger keyed by Stripe event id.',
  'supabase-notification.repository.ts':
    'notifications carries chapter_id but no read filters by it — findByUser filters by user_id, findById by id alone; needs a scoping decision before a test can pin behaviour.',
  'supabase-message-reaction.repository.ts':
    'reactions are message-scoped like poll_votes; covered indirectly by the chat-channel boundary. Backlog.',
  'supabase-chat-message-action.repository.ts':
    'message actions are message-scoped like poll_votes. Backlog.',
  'supabase-read-receipt.repository.ts':
    'read receipts are channel-scoped; the unread-count RPC does take p_chapter_id. Backlog.',
  'supabase-activation-milestone.repository.ts':
    'chapter-scoped and upsert-only; low blast radius, and no hook call site in the query-key migration. Backlog.',
};

const specPathFor = (fullPath: string) => fullPath.replace(/\.ts$/, '.spec.ts');

describe('API repository tenant-scope coverage', () => {
  const repositories = collectRepositories(SRC_ROOT);

  it('repository basenames are unique so the backlog can key on the file name', () => {
    const counts = new Map<string, number>();
    for (const { fileName } of repositories) {
      counts.set(fileName, (counts.get(fileName) ?? 0) + 1);
    }
    const duplicates = [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([name]) => name);
    expect(duplicates).toEqual([]);
  });

  it('every repository either has a tenant-scope spec or a recorded reason', () => {
    const uncovered = repositories
      .filter(
        ({ fileName, fullPath }) =>
          !existsSync(specPathFor(fullPath)) &&
          !(fileName in TENANT_SCOPE_BACKLOG),
      )
      .map(({ fileName }) => fileName);

    expect(uncovered).toEqual([]);
  });

  it('the backlog names only repositories that still exist and lack a spec', () => {
    const byName = new Map(repositories.map((r) => [r.fileName, r]));

    const stale = Object.keys(TENANT_SCOPE_BACKLOG).filter((fileName) => {
      const hit = byName.get(fileName);
      return !hit || existsSync(specPathFor(hit.fullPath));
    });

    expect(stale).toEqual([]);
  });

  it('every tenant-scope spec drives the shared harness', () => {
    // A spec that hand-rolls its own Supabase double gets none of the guards in
    // `createTenantHarness` — the colliding-twin check above all — so it can
    // pass while proving nothing.
    const withoutHarness = repositories
      .filter(({ fileName }) => !(fileName in TENANT_SCOPE_BACKLOG))
      .filter(({ fullPath }) => {
        const text = readFileSync(specPathFor(fullPath), 'utf8');
        return !text.includes('createTenantHarness');
      })
      .map(({ fileName }) => fileName);

    expect(withoutHarness).toEqual([]);
  });

  it('reports how much of the repository layer is covered', () => {
    const covered =
      repositories.length - Object.keys(TENANT_SCOPE_BACKLOG).length;

    // Pinned so shrinking coverage is a deliberate edit rather than a silent
    // regression. Raise it as backlog entries are cleared. Denominator is
    // every `*.repository.ts` under `apps/api/src` (38 supabase-* plus the
    // two module-local workers).
    expect({ covered, total: repositories.length }).toEqual({
      covered: 31,
      total: 40,
    });
  });
});
