import { Logger } from '@nestjs/common';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { ChatPushDispatchRepository } from './chat-push-dispatch.repository';

/**
 * The claim's half that lives in the repository: how an insert's outcome maps
 * to who may send, and what the purge deletes (#2846).
 *
 * Every worker spec stubs this class, so without these cases a wrong mapping
 * (a `23505` read as `claimed`) would put every instance back to sending every
 * push with the suite green.
 *
 * Not named `chat-push-dispatch.repository.spec.ts`: that sibling name is the
 * tenant-scope spec `tenant-scope-coverage.spec.ts` looks for, and this table
 * has no tenant column (its ledger line says why).
 */

interface InsertCall {
  table: string;
  row: unknown;
}

interface DeleteCall {
  table: string;
  options: unknown;
  column: string;
  value: unknown;
}

function fakeClient(result: {
  insert?: { error: { code?: string; message?: string } | null };
  delete?: {
    count: number | null;
    error: { code?: string; message?: string } | null;
  };
}) {
  const inserts: InsertCall[] = [];
  const deletes: DeleteCall[] = [];
  const client = {
    from: (table: string) => ({
      insert: (row: unknown) => {
        inserts.push({ table, row });
        return Promise.resolve(result.insert ?? { error: null });
      },
      delete: (options: unknown) => ({
        lt: (column: string, value: unknown) => {
          deletes.push({ table, options, column, value });
          return Promise.resolve(result.delete ?? { count: 0, error: null });
        },
      }),
    }),
  } as unknown as FrappSupabaseClient;
  return { client, inserts, deletes };
}

describe('ChatPushDispatchRepository', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('claim', () => {
    it('claims the message when the insert succeeds', async () => {
      const { client, inserts } = fakeClient({ insert: { error: null } });
      const repo = new ChatPushDispatchRepository(client);

      await expect(repo.claim('m-1')).resolves.toBe('claimed');
      expect(inserts).toEqual([
        { table: 'chat_push_dispatches', row: { message_id: 'm-1' } },
      ]);
    });

    it('reads a unique violation as another instance owning the message', async () => {
      const { client } = fakeClient({
        insert: { error: { code: '23505', message: 'duplicate key' } },
      });
      const repo = new ChatPushDispatchRepository(client);

      await expect(repo.claim('m-1')).resolves.toBe('taken');
      expect(Logger.prototype.error).not.toHaveBeenCalled();
    });

    it('reads a foreign-key violation as a message deleted before its push', async () => {
      const { client } = fakeClient({
        insert: { error: { code: '23503', message: 'violates foreign key' } },
      });
      const repo = new ChatPushDispatchRepository(client);

      await expect(repo.claim('m-1')).resolves.toBe('gone');
      expect(Logger.prototype.error).not.toHaveBeenCalled();
    });

    // An insert whose outcome is unknown must not authorize a send: a missed
    // push is the cheaper mistake than one sent by every instance.
    it('does not claim, and logs, when the insert fails any other way', async () => {
      const { client } = fakeClient({
        insert: { error: { code: '08006', message: 'connection failure' } },
      });
      const repo = new ChatPushDispatchRepository(client);

      await expect(repo.claim('m-1')).resolves.toBe('failed');
      expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('purgeBefore', () => {
    it('deletes claims made before the cutoff and returns the count', async () => {
      const { client, deletes } = fakeClient({
        delete: { count: 7, error: null },
      });
      const repo = new ChatPushDispatchRepository(client);
      const cutoff = new Date('2026-09-29T12:00:00.000Z');

      await expect(repo.purgeBefore(cutoff)).resolves.toBe(7);
      expect(deletes).toEqual([
        {
          table: 'chat_push_dispatches',
          options: { count: 'exact' },
          column: 'dispatched_at',
          value: '2026-09-29T12:00:00.000Z',
        },
      ]);
    });

    it('reads a missing count as nothing deleted', async () => {
      const { client } = fakeClient({ delete: { count: null, error: null } });
      const repo = new ChatPushDispatchRepository(client);

      await expect(repo.purgeBefore(new Date())).resolves.toBe(0);
    });

    it('throws a failed delete for the caller to log', async () => {
      const error = { code: '57014', message: 'canceling statement' };
      const { client } = fakeClient({ delete: { count: null, error } });
      const repo = new ChatPushDispatchRepository(client);

      await expect(repo.purgeBefore(new Date())).rejects.toBe(error);
    });
  });
});
