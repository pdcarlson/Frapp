import { ChatNotificationPreferenceRepository } from './chat-notification-preference.repository';
import {
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_notification_preferences` (push-worker lookup).
 *
 * `findForUser(userId, chapterId)` is the only method. The worker already
 * knows the chapter of the message it is notifying about; this spec pins that
 * the query binds `chapter_id` rather than returning the same user's prefs
 * from another chapter.
 */

const PREF_A = '0a000000-0000-4000-8000-000000000210';
const PREF_B = '0b000000-0000-4000-8000-000000000210';
const CHANNEL_SHARED = '0c000000-0000-4000-8000-000000000210';

const seed = () => ({
  chat_notification_preferences: [
    inA({
      id: PREF_A,
      user_id: USER_SHARED,
      scope: 'channel',
      scope_id: CHANNEL_SHARED,
      scope_kind: null,
      level: 'all',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: PREF_B,
      user_id: USER_SHARED,
      scope: 'channel',
      scope_id: CHANNEL_SHARED,
      scope_kind: null,
      level: 'all',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('ChatNotificationPreferenceRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: ChatNotificationPreferenceRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
    });
    repo = new ChatNotificationPreferenceRepository(harness.client);
  });

  it('findForUser returns only the caller chapter prefs for the shared user', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findForUser(USER_SHARED, CHAPTER_B),
    );

    expect(rows.map((r) => r.id)).toEqual([PREF_B]);
  });
});
