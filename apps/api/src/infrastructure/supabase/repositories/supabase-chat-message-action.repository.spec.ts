import { SupabaseChatMessageActionRepository } from './supabase-chat-message-action.repository';
import {
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_message_actions`.
 *
 * No method here takes a chapter, and the table has no `chapter_id` — an
 * action's chapter is its message's channel's. `ChatService.recordMessageAction`
 * establishes that first via `assertMessageAccess`, so every call is already
 * scoped to a message the caller can see.
 *
 * What this spec can therefore prove is narrower than elsewhere, and saying so
 * is the point: the (message_id, user_id, action_type) predicate is applied, so
 * the upstream check is scoping something real. Two vote rows in two chapters
 * share a voter, an action type, a payload and a timestamp; only `message_id`
 * separates them.
 */

const MESSAGE_A = '0a000000-0000-4000-8000-000000000160';
const MESSAGE_B = '0b000000-0000-4000-8000-000000000160';
const ACTION_A = '0a000000-0000-4000-8000-000000000161';
const ACTION_B = '0b000000-0000-4000-8000-000000000161';

const CHANNEL_A = '0a000000-0000-4000-8000-000000000162';
const CHANNEL_B = '0b000000-0000-4000-8000-000000000162';

const MISSING_MESSAGE = '0c000000-0000-4000-8000-000000000160';

const seed = () => ({
  chat_channels: [
    inA({ id: CHANNEL_A, name: 'general', type: 'PUBLIC' }),
    inB({ id: CHANNEL_B, name: 'general', type: 'PUBLIC' }),
  ],
  chat_messages: [
    { id: MESSAGE_A, channel_id: CHANNEL_A, type: 'POLL' },
    { id: MESSAGE_B, channel_id: CHANNEL_B, type: 'POLL' },
  ],
  chat_message_actions: [
    {
      id: ACTION_A,
      message_id: MESSAGE_A,
      user_id: USER_SHARED,
      action_type: 'vote',
      payload: { option_id: 'opt-a' },
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: ACTION_B,
      message_id: MESSAGE_B,
      user_id: USER_SHARED,
      action_type: 'vote',
      payload: { option_id: 'opt-a' },
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ],
});

describe('SupabaseChatMessageActionRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatMessageActionRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      untenantedTables: ['chat_message_actions', 'chat_messages'],
      // An action's chapter is two hops away: action → message → channel.
      // Wiring it up keeps the foreign-write check alive for a table that
      // could otherwise be emptied by a mis-filtered update without anything
      // noticing.
      parentTenant: {
        chat_message_actions: { column: 'message_id', table: 'chat_messages' },
        chat_messages: { column: 'channel_id', table: 'chat_channels' },
      },
    });
    repo = new SupabaseChatMessageActionRepository(harness.client);
  });

  it('findOne does not return the same voter action in another chapter', async () => {
    const action = await repo.findOne(MESSAGE_B, USER_SHARED, 'vote');

    expect(action?.id).toBe(ACTION_B);
  });

  it('updateForVote leaves the other chapter action in place', async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.updateForVote(MESSAGE_B, USER_SHARED, 'vote', {
        option_id: 'opt-b',
      }),
    );

    expect(updated?.id).toBe(ACTION_B);
    expect(updated?.payload).toEqual({ option_id: 'opt-b' });
    expect(
      harness.rows('chat_message_actions').find((row) => row.id === ACTION_A)
        ?.payload,
    ).toEqual({ option_id: 'opt-a' });
  });

  it('updateForVote returns null when no row matches (not PGRST116)', async () => {
    // Zero rows used to throw PostgREST PGRST116 because the query ended in
    // `.single()`. The domain contract is `Promise<ChatMessageAction | null>`
    // so ChatService can re-raise ChatMessageActionDuplicateError instead of
    // leaking PGRST116 out of the UPSERT recovery catch.
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.updateForVote(MISSING_MESSAGE, USER_SHARED, 'vote', {
        option_id: 'opt-b',
      }),
    );

    expect(updated).toBeNull();
    expect(
      harness
        .rows('chat_message_actions')
        .map((row) => row.id)
        .sort(),
    ).toEqual([ACTION_A, ACTION_B]);
  });
});
