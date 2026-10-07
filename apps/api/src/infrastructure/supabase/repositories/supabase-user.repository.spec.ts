import { SupabaseUserRepository } from './supabase-user.repository';
import { SupabaseQueryError } from '../supabase-query-error';
import type { FrappSupabaseClient } from '../database.types';
import { ID_CHUNK_SIZE } from '#domain/utils/chunk-ids';
import {
  USER_A,
  USER_B,
  createTenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * `users` is global: identity exists before and across chapters, so there is
 * no tenant predicate to prove. What a caller relies on instead is that the
 * batched reads return exactly the ids they are handed — the ids come from a
 * chapter's own rows, which is what scopes them — and that a chapter-sized id
 * list is chunked rather than sent as one `in (...)` that 414s.
 */

const userRow = (id: string, name: string) => ({
  id,
  display_name: name,
  email: `${name.toLowerCase()}@x.dev`,
  avatar_url: null,
});

describe('SupabaseUserRepository — batched reads', () => {
  it('return only the requested users', async () => {
    const harness = createTenantHarness({
      tables: {
        users: [userRow(USER_A, 'Ann'), userRow(USER_B, 'Bob')],
      },
      untenantedTables: ['users'],
    });
    const repo = new SupabaseUserRepository(harness.client);

    const identities = await repo.findDisplayIdentitiesByIds([USER_B]);
    const contacts = await repo.findContactsByIds([USER_B]);

    expect(identities.map((u) => u.id)).toEqual([USER_B]);
    expect(contacts).toEqual([
      expect.objectContaining({ id: USER_B, email: 'bob@x.dev' }),
    ]);
  });

  /** A client whose `users` reads answer each chunk with its own ids. */
  const chunkClient = (failOnChunk?: number) => {
    const selects: string[] = [];
    const chunks: string[][] = [];
    const from = jest.fn(() => {
      const chain: Record<string, jest.Mock> = {};
      chain.select = jest.fn((columns: string) => {
        selects.push(columns);
        return chain;
      });
      chain.in = jest.fn((_column: string, chunk: string[]) => {
        chunks.push(chunk);
        if (chunks.length === failOnChunk) {
          return Promise.resolve({
            data: null,
            error: { code: '57014', message: 'canceling statement' },
          });
        }
        return Promise.resolve({
          data: chunk.map((id) => userRow(id, id)),
          error: null,
        });
      });
      return chain;
    });
    return {
      client: { from } as unknown as FrappSupabaseClient,
      from,
      selects,
      chunks,
    };
  };

  const ids = Array.from({ length: ID_CHUNK_SIZE + 23 }, (_, i) => `u-${i}`);

  describe.each([
    ['findDisplayIdentitiesByIds', 'id, display_name, avatar_url'],
    ['findContactsByIds', 'id, display_name, email'],
  ] as const)('%s', (method, columns) => {
    it('reads a chapter-sized id list in chunks and keeps every row', async () => {
      // One `in (...)` holding a whole chapter overflows the request line and
      // returns 414 (`domain/utils/chunk-ids`).
      const { client, chunks, selects } = chunkClient();

      const rows = await new SupabaseUserRepository(client)[method](ids);

      expect(rows.map((r) => r.id)).toEqual(ids);
      expect(chunks.map((c) => c.length)).toEqual([ID_CHUNK_SIZE, 23]);
      expect(selects).toEqual([columns, columns]);
    });

    it('fails the read when any chunk fails, rather than dropping it', async () => {
      // A dropped chunk would render as members with blank names and no error.
      const { client } = chunkClient(2);

      await expect(
        new SupabaseUserRepository(client)[method](ids),
      ).rejects.toBeInstanceOf(SupabaseQueryError);
    });

    it('does not query for an empty id list', async () => {
      const { client, from } = chunkClient();

      await expect(
        new SupabaseUserRepository(client)[method]([]),
      ).resolves.toEqual([]);
      expect(from).not.toHaveBeenCalled();
    });
  });
});
