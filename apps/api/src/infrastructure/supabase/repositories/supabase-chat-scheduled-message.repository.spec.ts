import { SupabaseChatScheduledMessageRepository } from './supabase-chat-scheduled-message.repository';
import {
  CHAPTER_A,
  USER_A,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_scheduled_messages` (#4956).
 *
 * Two scopes: `chapter_id`, which the harness checks, and `user_id`, which it
 * does not know about. A member's scheduled messages are theirs alone, so the
 * author-facing reads and writes are asserted on both. The sweep's
 * `findDue` reads every chapter on purpose; its writes are by id and chapter.
 */

const ROW_A = '0a000000-0000-4000-8000-000000004956';
const ROW_B = '0b000000-0000-4000-8000-000000004956';
const ROW_A_OTHERS = '0a000000-0000-4000-8000-000000004957';
const ROW_A_LATER = '0a000000-0000-4000-8000-000000004958';
const ROW_B_OTHERS = '0b000000-0000-4000-8000-000000004957';
const ROW_B_LATER = '0b000000-0000-4000-8000-000000004958';
const ROW_A_FAILED = '0a000000-0000-4000-8000-000000004959';
const ROW_B_FAILED = '0b000000-0000-4000-8000-000000004959';
const CHANNEL_A = '0a000000-0000-4000-8000-0000000c4956';
const CHANNEL_B = '0b000000-0000-4000-8000-0000000c4956';

const NOW = '2026-11-14T13:00:00.000Z';
const DUE = '2026-11-14T12:59:00.000Z';
const LATER = '2026-11-15T13:00:00.000Z';

const row = (columns: Record<string, unknown>) => ({
  member_id: 'member-1',
  content: 'Chapter at 8',
  mention_picks: null,
  status: 'pending',
  failure_reason: null,
  attempts: 0,
  lease_until: null,
  created_at: '2026-11-13T20:00:00.000Z',
  updated_at: '2026-11-13T20:00:00.000Z',
  ...columns,
});

const seed = () => ({
  chat_scheduled_messages: [
    inA(
      row({
        id: ROW_A,
        user_id: USER_SHARED,
        channel_id: CHANNEL_A,
        send_at: DUE,
      }),
    ),
    inB(
      row({
        id: ROW_B,
        user_id: USER_SHARED,
        channel_id: CHANNEL_B,
        send_at: DUE,
      }),
    ),
    inA(
      row({
        id: ROW_A_OTHERS,
        user_id: USER_A,
        channel_id: CHANNEL_A,
        send_at: DUE,
      }),
    ),
    inA(
      row({
        id: ROW_A_LATER,
        user_id: USER_SHARED,
        channel_id: CHANNEL_A,
        send_at: LATER,
      }),
    ),
    inB(
      row({
        id: ROW_B_OTHERS,
        user_id: USER_A,
        channel_id: CHANNEL_B,
        send_at: DUE,
      }),
    ),
    inB(
      row({
        id: ROW_B_LATER,
        user_id: USER_SHARED,
        channel_id: CHANNEL_B,
        send_at: LATER,
      }),
    ),
    inA(
      row({
        id: ROW_A_FAILED,
        user_id: USER_SHARED,
        channel_id: CHANNEL_A,
        send_at: DUE,
        status: 'failed',
        failure_reason: 'no_access',
      }),
    ),
    inB(
      row({
        id: ROW_B_FAILED,
        user_id: USER_SHARED,
        channel_id: CHANNEL_B,
        send_at: DUE,
        status: 'failed',
        failure_reason: 'no_access',
      }),
    ),
  ],
});

describe('SupabaseChatScheduledMessageRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatScheduledMessageRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: {
        chat_scheduled_messages: ['channel_id', 'member_id'],
      },
    });
    repo = new SupabaseChatScheduledMessageRepository(harness.client);
  });

  const stored = (id: string) =>
    harness.rows('chat_scheduled_messages').find((r) => r.id === id);

  it('listForAuthor reads only the author’s own rows in the chapter, soonest first', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listForAuthor(CHAPTER_A, USER_SHARED),
    );
    expect(rows.map((r) => r.id).sort()).toEqual(
      [ROW_A, ROW_A_FAILED, ROW_A_LATER].sort(),
    );
  });

  it('listForAuthor narrows to one channel', async () => {
    const rows = await repo.listForAuthor(CHAPTER_A, USER_SHARED, CHANNEL_B);
    expect(rows).toEqual([]);
  });

  it('findForAuthor does not resolve the other chapter’s or another member’s row', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findForAuthor(CHAPTER_A, USER_SHARED, ROW_B),
      ),
    ).resolves.toBeNull();
    await expect(
      repo.findForAuthor(CHAPTER_A, USER_SHARED, ROW_A_OTHERS),
    ).resolves.toBeNull();
    await expect(
      repo.findForAuthor(CHAPTER_A, USER_SHARED, ROW_A),
    ).resolves.toMatchObject({ id: ROW_A });
  });

  it('create writes inside the chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.create({
        chapter_id: CHAPTER_A,
        channel_id: CHANNEL_A,
        user_id: USER_SHARED,
        member_id: 'member-1',
        content: 'Dues are due',
        mention_picks: null,
        send_at: LATER,
      }),
    );
    expect(
      harness
        .rows('chat_scheduled_messages')
        .filter((r) => r.content === 'Dues are due'),
    ).toHaveLength(1);
  });

  it('updateForAuthor changes only the author’s own row and starts it over', async () => {
    harness.reset();
    const updated = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.updateForAuthor(
        CHAPTER_A,
        USER_SHARED,
        ROW_A,
        { content: 'New' },
        NOW,
      ),
    );
    expect(updated).toMatchObject({
      id: ROW_A,
      content: 'New',
      status: 'pending',
      attempts: 0,
    });
    await expect(
      repo.updateForAuthor(
        CHAPTER_A,
        USER_SHARED,
        ROW_A_OTHERS,
        { content: 'x' },
        NOW,
      ),
    ).resolves.toBeNull();
    await expect(
      repo.updateForAuthor(
        CHAPTER_A,
        USER_SHARED,
        ROW_B,
        { content: 'x' },
        NOW,
      ),
    ).resolves.toBeNull();
    expect(stored(ROW_B)?.content).toBe('Chapter at 8');
  });

  it('updateForAuthor refuses a row a send holds', async () => {
    await repo.claim(
      { id: ROW_A, chapter_id: CHAPTER_A, attempts: 0 },
      LATER,
      NOW,
    );
    await expect(
      repo.updateForAuthor(
        CHAPTER_A,
        USER_SHARED,
        ROW_A,
        { content: 'x' },
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it('deleteForAuthor deletes only the author’s own row in the chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.deleteForAuthor(CHAPTER_A, USER_SHARED, ROW_B, NOW),
      ),
    ).resolves.toBe('missing');
    await expect(
      repo.deleteForAuthor(CHAPTER_A, USER_SHARED, ROW_A_OTHERS, NOW),
    ).resolves.toBe('missing');
    await expect(
      repo.deleteForAuthor(CHAPTER_A, USER_SHARED, ROW_A, NOW),
    ).resolves.toBe('deleted');
    expect(stored(ROW_A)).toBeUndefined();
    expect(stored(ROW_B)).toBeDefined();
  });

  it('deleteForAuthor leaves a row a send holds', async () => {
    await repo.claim(
      { id: ROW_A, chapter_id: CHAPTER_A, attempts: 0 },
      LATER,
      NOW,
    );
    await expect(
      repo.deleteForAuthor(CHAPTER_A, USER_SHARED, ROW_A, NOW),
    ).resolves.toBe('held');
    expect(stored(ROW_A)).toBeDefined();
  });

  it('countPending counts only the author’s pending rows in the chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.countPending(CHAPTER_A, USER_SHARED),
      ),
    ).resolves.toBe(2);
  });

  it('findDue reads due, unheld pending rows from every chapter, never a failed one', async () => {
    const rows = await repo.findDue(NOW, 10);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [ROW_A, ROW_A_OTHERS, ROW_B, ROW_B_OTHERS].sort(),
    );
  });

  it('findDue leaves out a row a send holds', async () => {
    await repo.claim(
      { id: ROW_A, chapter_id: CHAPTER_A, attempts: 0 },
      LATER,
      NOW,
    );
    const rows = await repo.findDue(NOW, 10);
    expect(rows.map((r) => r.id)).not.toContain(ROW_A);
  });

  it('claim wins once per attempt count, inside the chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.claim(
          { id: ROW_A, chapter_id: CHAPTER_A, attempts: 0 },
          LATER,
          NOW,
        ),
      ),
    ).resolves.toMatchObject({ id: ROW_A, attempts: 1 });
    expect(stored(ROW_A)).toMatchObject({ attempts: 1, lease_until: LATER });
    await expect(
      repo.claim({ id: ROW_A, chapter_id: CHAPTER_A, attempts: 0 }, LATER, NOW),
    ).resolves.toBeNull();
    // The other chapter's row by its id, under this chapter.
    await expect(
      repo.claim({ id: ROW_B, chapter_id: CHAPTER_A, attempts: 0 }, LATER, NOW),
    ).resolves.toBeNull();
    // A failed row is never claimed.
    await expect(
      repo.claim(
        { id: ROW_A_FAILED, chapter_id: CHAPTER_A, attempts: 0 },
        LATER,
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it('claim with dueBy leaves a row an edit moved later, and answers the edited row', async () => {
    await repo.updateForAuthor(
      CHAPTER_A,
      USER_SHARED,
      ROW_A,
      { content: 'New' },
      NOW,
    );
    await expect(
      repo.claim(
        { id: ROW_A, chapter_id: CHAPTER_A, attempts: 0 },
        LATER,
        NOW,
        NOW,
      ),
    ).resolves.toMatchObject({ content: 'New' });
    await repo.updateForAuthor(
      CHAPTER_A,
      USER_SHARED,
      ROW_A_LATER,
      { send_at: LATER },
      NOW,
    );
    await expect(
      repo.claim(
        { id: ROW_A_LATER, chapter_id: CHAPTER_A, attempts: 0 },
        LATER,
        NOW,
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it('removeSent and markFailed write only inside the row’s chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.markFailed({ id: ROW_A, chapter_id: CHAPTER_A }, 'no_access'),
    );
    expect(stored(ROW_A)).toMatchObject({
      status: 'failed',
      failure_reason: 'no_access',
    });
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.removeSent({ id: ROW_A, chapter_id: CHAPTER_A }),
    );
    expect(stored(ROW_A)).toBeUndefined();
    await repo.removeSent({ id: ROW_B, chapter_id: CHAPTER_A });
    expect(stored(ROW_B)).toBeDefined();
  });
});
