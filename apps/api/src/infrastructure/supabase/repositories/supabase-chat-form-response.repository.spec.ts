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
 * same form, so a dropped filter returns their row.
 */

const FORM = '0a000000-0000-4000-8000-000000003926';
const OTHER_FORM = '0a000000-0000-4000-8000-000000003927';

const response = (
  messageId: string,
  userId: string,
  answers: Record<string, string | string[]>,
) => ({
  message_id: messageId,
  user_id: userId,
  answers,
  created_at: '2026-11-13T00:00:00.000Z',
  updated_at: '2026-11-13T01:00:00.000Z',
});

const seed = () => ({
  chat_form_responses: [
    response(FORM, USER_SHARED, { room: 'single' }),
    response(FORM, USER_A, { room: 'double' }),
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

  it('findAnsweredMessageIds names only the forms the caller answered', async () => {
    const { repo } = build();
    await expect(
      repo.findAnsweredMessageIds([FORM, OTHER_FORM], USER_SHARED),
    ).resolves.toEqual([FORM]);
    // USER_B answered the other form only; USER_A's row on FORM is not theirs.
    await expect(
      repo.findAnsweredMessageIds([FORM, OTHER_FORM], USER_B),
    ).resolves.toEqual([OTHER_FORM]);
    await expect(repo.findAnsweredMessageIds([], USER_SHARED)).resolves.toEqual(
      [],
    );
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
