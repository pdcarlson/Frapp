import { SupabaseChatFormResponseRepository } from './supabase-chat-form-response.repository';
import { FormResponseRefusedError } from '#domain/repositories/chat-form-response.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';
import {
  USER_A,
  USER_B,
  USER_SHARED,
  createTenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Member scope for `chat_form_responses` (#3926 step 3).
 *
 * The table has no chapter column: the card is authorized in the caller's
 * chapter by `ChatFormService` (`assertMessageAccess`) before any call, so the
 * harness's tenant checks have nothing to hold here. What this repository
 * alone enforces is the member boundary. RLS is on with no policies and the
 * API reads through the service role, so the `user_id` filter is the only
 * thing between one member's answers and another's. `USER_A` has answered the
 * same form, so a dropped filter returns their row. `findAllForCreator`
 * (#3926 step 4) is the one unfiltered read; `ChatFormService` guards it with
 * the sender check, so here it is held only to its one form and its order.
 */

const FORM = '0a000000-0000-4000-8000-000000003926';
const OTHER_FORM = '0a000000-0000-4000-8000-000000003927';

const response = (
  messageId: string,
  userId: string,
  answers: Record<string, string | string[]>,
  createdAt = '2026-11-13T00:00:00.000Z',
) => ({
  message_id: messageId,
  user_id: userId,
  answers,
  created_at: createdAt,
  updated_at: '2026-11-13T01:00:00.000Z',
});

// Seeded out of answer order: `USER_A` answered first, so a read that drops
// or flips its `created_at` order returns them second.
const seed = () => ({
  chat_form_responses: [
    response(FORM, USER_SHARED, { room: 'single' }, '2026-11-13T00:05:00.000Z'),
    response(FORM, USER_A, { room: 'double' }, '2026-11-13T00:00:00.000Z'),
    response(OTHER_FORM, USER_B, { room: 'triple' }),
  ],
});

describe('SupabaseChatFormResponseRepository — member scope', () => {
  const build = (rpc?: Record<string, { data?: unknown; error?: unknown }>) => {
    const harness = createTenantHarness({
      tables: seed(),
      untenantedTables: ['chat_form_responses'],
      rpc,
    });
    return {
      harness,
      repo: new SupabaseChatFormResponseRepository(harness.client),
    };
  };

  it("findOwn returns the caller's own answers, never another member's", async () => {
    const { repo } = build();
    await expect(repo.findOwn(FORM, USER_SHARED)).resolves.toMatchObject({
      user_id: USER_SHARED,
      answers: { room: 'single' },
    });
    await expect(repo.findOwn(FORM, USER_A)).resolves.toMatchObject({
      user_id: USER_A,
      answers: { room: 'double' },
    });
  });

  it('findOwn is null for a member who has not answered, though others have', async () => {
    const { repo } = build();
    await expect(repo.findOwn(FORM, USER_B)).resolves.toBeNull();
  });

  it('findAllForCreator reads every member’s answers to that one form only, first answered first', async () => {
    const { repo } = build();
    const rows = await repo.findAllForCreator(FORM);
    expect(rows.map((row) => row.user_id)).toEqual([USER_A, USER_SHARED]);
    expect(rows.every((row) => row.message_id === FORM)).toBe(true);
  });

  it('findAnswered names only the forms the caller answered, and when', async () => {
    const { repo } = build();
    const answeredAt = '2026-11-13T00:00:00.000Z';
    await expect(
      repo.findAnswered([FORM, OTHER_FORM], USER_SHARED),
    ).resolves.toEqual([{ message_id: FORM, created_at: answeredAt }]);
    // USER_B answered the other form only; USER_A's row on FORM is not theirs.
    await expect(
      repo.findAnswered([FORM, OTHER_FORM], USER_B),
    ).resolves.toEqual([{ message_id: OTHER_FORM, created_at: answeredAt }]);
    await expect(repo.findAnswered([], USER_SHARED)).resolves.toEqual([]);
  });

  it('save passes the caller as the member whose answers it replaces', async () => {
    const saved = response(FORM, USER_SHARED, { room: 'double' });
    const { harness, repo } = build({
      save_chat_form_response: { data: saved },
    });
    await expect(
      repo.save(FORM, USER_SHARED, { room: 'double' }),
    ).resolves.toEqual(saved);
    expect(harness.rpcCalls).toEqual([
      {
        fn: 'save_chat_form_response',
        args: {
          p_message_id: FORM,
          p_user_id: USER_SHARED,
          p_answers: { room: 'double' },
        },
      },
    ]);
  });

  it.each([
    ['form_closed', 'closed'],
    ['form_card_missing', 'missing'],
  ] as const)(
    'save turns the RPC refusal %s into a refused save (%s)',
    async (message, reason) => {
      const { repo } = build({
        save_chat_form_response: { error: { message, code: 'P0001' } },
      });
      const failure = await repo
        .save(FORM, USER_SHARED, { room: 'single' })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(FormResponseRefusedError);
      expect((failure as FormResponseRefusedError).reason).toBe(reason);
    },
  );

  it('save reports any other RPC error as a failure', async () => {
    const { repo } = build({
      save_chat_form_response: {
        error: { message: 'connection reset', code: '08006' },
      },
    });
    await expect(
      repo.save(FORM, USER_SHARED, { room: 'single' }),
    ).rejects.toBeInstanceOf(SupabaseQueryError);
  });
});
