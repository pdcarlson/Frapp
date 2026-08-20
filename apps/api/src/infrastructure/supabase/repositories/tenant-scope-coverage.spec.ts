import { readdirSync, readFileSync } from 'node:fs';
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
 * This is not a quality gate on the specs themselves; a spec that exists but
 * asserts nothing satisfies it. What stops that is `tenant-scope.harness.spec.ts`,
 * which proves the harness those specs use can still fail.
 */

const REPOSITORY_DIR = __dirname;

/**
 * Repositories deliberately not covered in this pass, each with the reason.
 * Everything here is either structurally untenanted or outside the
 * security/dues/points and query-key-migration scope that was prioritised.
 *
 * Moving a line out of this list means writing the spec; deleting a line
 * without writing one puts the repository back in the failing set.
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

describe('Supabase repository tenant-scope coverage', () => {
  const repositories = readdirSync(REPOSITORY_DIR).filter(
    (name) => name.startsWith('supabase-') && name.endsWith('.repository.ts'),
  );

  const specFor = (repository: string) =>
    repository.replace(/\.ts$/, '.spec.ts');

  it('every repository either has a tenant-scope spec or a recorded reason', () => {
    const present = new Set(readdirSync(REPOSITORY_DIR));

    const uncovered = repositories.filter(
      (repository) =>
        !present.has(specFor(repository)) &&
        !(repository in TENANT_SCOPE_BACKLOG),
    );

    expect(uncovered).toEqual([]);
  });

  it('the backlog names only repositories that still exist and lack a spec', () => {
    const present = new Set(readdirSync(REPOSITORY_DIR));

    const stale = Object.keys(TENANT_SCOPE_BACKLOG).filter(
      (repository) =>
        !repositories.includes(repository) || present.has(specFor(repository)),
    );

    expect(stale).toEqual([]);
  });

  it('every tenant-scope spec drives the shared harness', () => {
    // A spec that hand-rolls its own Supabase double gets none of the guards in
    // `createTenantHarness` — the colliding-twin check above all — so it can
    // pass while proving nothing.
    const withoutHarness = repositories
      .filter((repository) => !(repository in TENANT_SCOPE_BACKLOG))
      .filter((repository) => {
        const text = readFileSync(
          join(REPOSITORY_DIR, specFor(repository)),
          'utf8',
        );
        return !text.includes('createTenantHarness');
      });

    expect(withoutHarness).toEqual([]);
  });

  it('reports how much of the repository layer is covered', () => {
    const covered =
      repositories.length - Object.keys(TENANT_SCOPE_BACKLOG).length;

    // Pinned so shrinking coverage is a deliberate edit rather than a silent
    // regression. Raise it as backlog entries are cleared.
    expect({ covered, total: repositories.length }).toEqual({
      covered: 24,
      total: 33,
    });
  });
});
