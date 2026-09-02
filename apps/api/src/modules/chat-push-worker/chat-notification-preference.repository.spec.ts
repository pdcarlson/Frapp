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

  /**
   * Same binding, on the read that backs the mute UI (#296). The worker's
   * lookup and the UI's lookup are separate methods, so tenant scope has to be
   * pinned on both — a `chapter_id` filter dropped from one would not be caught
   * by the other's test.
   */
  it('findChannelPreferencesForUser binds chapter_id too', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findChannelPreferencesForUser(USER_SHARED, CHAPTER_B),
    );

    expect(rows.map((r) => r.id)).toEqual([PREF_B]);
  });

  /**
   * The kind arm's read (#500). Same reasoning as the channel read above: a
   * `chapter_id` filter dropped from this one would be caught by neither of
   * the other two tests.
   */
  it('findKindPreferencesForUser binds chapter_id too', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findKindPreferencesForUser(USER_SHARED, CHAPTER_B),
    );

    // The seed holds only channel-scoped rows, so the scope filter must
    // exclude both of them — an assertion that would fail if this method
    // stopped filtering on `scope`, which is what keeps the two UI reads from
    // reporting each other's rows.
    expect(rows).toEqual([]);
  });

  /**
   * The only DESTRUCTIVE method on this repository, and the one where a lost
   * `chapter_id` filter is worst: RLS is bypassed on the service-role client,
   * so these `.eq()` calls are the entire tenant boundary. A member of two
   * chapters clearing an override in one must not lose it in the other.
   *
   * Pinned here rather than in `chat.service.spec.ts`, where the repository is
   * mocked and the filter chain is therefore invisible.
   */
  it('deleteKindLevel binds user, chapter and scope', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.deleteKindLevel(USER_SHARED, CHAPTER_B, 'system_audit'),
    );

    const op = harness.ops.at(-1);
    expect(op?.mode).toBe('delete');

    const bound = Object.fromEntries(
      (op?.filters ?? [])
        .filter((f) => f.op === 'eq')
        .map((f) => [f.column, f.value]),
    );
    expect(bound).toEqual({
      user_id: USER_SHARED,
      chapter_id: CHAPTER_B,
      scope: 'kind',
      scope_kind: 'system_audit',
    });

    // Chapter A's row for the same user is untouched. `expectTenantScoped`
    // already proves no foreign row was written, but stating it directly is
    // what makes this test readable as "the other chapter survives".
    expect(
      harness.rows('chat_notification_preferences').map((r) => r.id),
    ).toContain(PREF_A);
  });

  /**
   * The two reads differ deliberately on error handling, and it is worth
   * pinning because it looks like an inconsistency.
   *
   * `findForUser` swallows: a failed preference lookup must not stop the worker
   * deciding a push at all, and a missed mute beats a dropped notification.
   * `findChannelPreferencesForUser` throws: there the array IS the answer, so
   * an empty list on a database error would render every channel as unmuted —
   * indistinguishable from the user having muted nothing, and the UI would
   * silently misreport their own settings back to them.
   */
  it('the UI read throws on error where the worker read degrades', async () => {
    const failing = createTenantHarness({ tables: seed() });
    // Chainable AND thenable, so the SAME failure lands whatever the builder
    // depth. The earlier fixed-depth mock only terminated after three `.eq()`
    // calls: `findChannelPreferencesForUser` makes exactly three and saw the
    // error, but `findForUser` makes two, so it awaited a plain object, read
    // `error` as `undefined` and returned through the happy path. An assertion
    // on it was therefore vacuous — it would have passed even if `findForUser`
    // threw on error, which is the very thing it is here to pin.
    const failure = { data: null, error: { message: 'boom' } };
    const chain: Record<string, unknown> = {
      eq: () => chain,
      then: (resolve: (v: typeof failure) => unknown) => resolve(failure),
    };
    jest.spyOn(failing.client, 'from').mockReturnValue({
      select: () => chain,
    });
    const failingRepo = new ChatNotificationPreferenceRepository(
      failing.client,
    );

    await expect(
      failingRepo.findChannelPreferencesForUser(USER_SHARED, CHAPTER_B),
    ).rejects.toBeDefined();

    // The other half of the same contract, which this test asserted only in
    // its title. Without it, "harmonising" `findForUser` to throw would keep
    // this suite green while making a transient PostgREST error propagate out
    // of the per-recipient loop in `handleMessage` — turning one member's
    // failed preference lookup into a dropped push for the whole message.
    // `chat-push-worker.service.spec.ts` cannot catch that either: it
    // hardcodes `findForUser` to resolve.
    const worker = new ChatNotificationPreferenceRepository(failing.client);
    await expect(worker.findForUser(USER_SHARED, CHAPTER_B)).resolves.toEqual(
      [],
    );
  });
});
