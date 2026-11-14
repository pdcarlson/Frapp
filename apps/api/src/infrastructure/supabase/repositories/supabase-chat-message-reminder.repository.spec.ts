import { SupabaseChatMessageReminderRepository } from './supabase-chat-message-reminder.repository';
import {
  CHAPTER_A,
  USER_SHARED,
  USER_A,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_message_reminders` (#4957), shaped like the bookmark
 * spec: the table has its own `chapter_id`, and a second scope the harness
 * does not know about, `user_id`, which is the privacy guarantee. Both are
 * asserted on the member-facing reads. The sweep's `findDue` and `claimDue`
 * walk every chapter by design and are covered by the sweep's own spec and
 * the integration spec.
 */

const MESSAGE_A = '0a000000-0000-4000-8000-000000000260';
const MESSAGE_B = '0b000000-0000-4000-8000-000000000260';
const MESSAGE_A_OTHER_USER = '0a000000-0000-4000-8000-000000000262';
const MESSAGE_B_OTHER_USER = '0b000000-0000-4000-8000-000000000262';

const REMINDER_A = '0a000000-0000-4000-8000-000000000270';
const REMINDER_B = '0b000000-0000-4000-8000-000000000270';
const REMINDER_A_OTHER_USER = '0a000000-0000-4000-8000-000000000272';
const REMINDER_B_OTHER_USER = '0b000000-0000-4000-8000-000000000272';

/** The harness ignores `select()`, so the embed is seeded under its key. */
const message = (id: string) => ({
  id,
  channel_id: '0a000000-0000-4000-8000-000000000280',
  content: 'dues are due Friday',
  is_deleted: false,
  created_at: '2026-01-01T00:00:00.000Z',
});

const row = (id: string, userId: string, messageId: string) => ({
  id,
  user_id: userId,
  message_id: messageId,
  remind_at: '2026-01-02T09:00:00.000Z',
  fired_at: null,
  created_at: '2026-01-01T12:00:00.000Z',
  updated_at: '2026-01-01T12:00:00.000Z',
  message: message(messageId),
});

const seed = () => ({
  chat_message_reminders: [
    inA(row(REMINDER_A, USER_SHARED, MESSAGE_A)),
    inB(row(REMINDER_B, USER_SHARED, MESSAGE_B)),
    inA(row(REMINDER_A_OTHER_USER, USER_A, MESSAGE_A_OTHER_USER)),
    inB(row(REMINDER_B_OTHER_USER, USER_A, MESSAGE_B_OTHER_USER)),
  ],
});

describe('SupabaseChatMessageReminderRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatMessageReminderRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: {
        chat_message_reminders: ['user_id', 'message_id', 'message'],
      },
    });
    repo = new SupabaseChatMessageReminderRepository(harness.client);
  });

  it('findByUserAndChapter does not return the same member’s reminder from another chapter', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findByUserAndChapter(USER_SHARED, CHAPTER_A, 50),
    );
    expect(rows.map((r) => r.id)).toEqual([REMINDER_A]);
  });

  it('findByUserAndChapter excludes another member’s reminder in the same chapter', async () => {
    const rows = await repo.findByUserAndChapter(USER_SHARED, CHAPTER_A, 50);
    expect(rows.map((r) => r.id)).not.toContain(REMINDER_A_OTHER_USER);
  });

  it('delete removes only the caller’s own reminder in this chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.delete(USER_SHARED, MESSAGE_A, CHAPTER_A),
    );
    expect(
      harness
        .rows('chat_message_reminders')
        .map((r) => r.id)
        .sort(),
    ).toEqual(
      [REMINDER_B, REMINDER_A_OTHER_USER, REMINDER_B_OTHER_USER].sort(),
    );
  });
});
