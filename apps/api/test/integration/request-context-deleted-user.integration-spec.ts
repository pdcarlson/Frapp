// A deleted account's users row is no user to the chapter guard, against the
// real database (#5043).
//
// Since Paul's 2026-11-16 decision, a read marked `@VerifySessionLocally()`
// accepts a token without asking Supabase Auth, so a deleted account's token
// stays valid until it expires. What refuses it is the guard's own `users`
// lookup, which now skips a row with `deleted_at` set. That lookup has two
// forms, and only a real database proves both: `get_request_context`'s `user`
// part (migration 20261116143520) and the direct read `ChapterGuard` makes
// when the call fails. The unit suite only proves the filter is asked for.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one).

import { randomUUID } from 'node:crypto';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('A deleted account is no user to the chapter guard', () => {
  let supabase: FrappSupabaseClient;

  const chapterId = randomUUID();
  const userId = randomUUID();
  const authId = randomUUID();

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  const setDeleted = async (deletedAt: string | null) =>
    assertOk(
      'users.deleted_at',
      (
        await supabase
          .from('users')
          .update({ deleted_at: deletedAt } as never)
          .eq('id', userId)
      ).error,
    );

  const contextUser = async () => {
    const { data, error } = await supabase.rpc('get_request_context', {
      p_auth_id: authId,
      p_chapter_id: chapterId,
    });
    if (error) throw new Error(error.message);
    return (data as { user: { id: string } | null }).user;
  };

  // The same query `lookupAppUser` in chapter.guard.ts makes.
  const directUser = async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('supabase_auth_id', authId)
      .is('deleted_at', null)
      .maybeSingle<{ id: string }>();
    if (error) throw new Error(error.message);
    return data;
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert({
          id: chapterId,
          name: `deleted-user-${chapterId.slice(0, 8)}`,
          university: 'Integration Test University',
        } as never)
      ).error,
    );
    assertOk(
      'users',
      (
        await supabase.from('users').insert({
          id: userId,
          supabase_auth_id: authId,
          email: `deleted-user-${userId}@example.test`,
        } as never)
      ).error,
    );
  });

  afterAll(async () => {
    await supabase.from('users').delete().eq('id', userId);
    await supabase.from('chapters').delete().eq('id', chapterId);
  });

  it('answers the live user from both lookups', async () => {
    await setDeleted(null);
    expect(await contextUser()).toEqual({ id: userId });
    expect(await directUser()).toEqual({ id: userId });
  });

  it('answers no user from either lookup once the row is tombstoned', async () => {
    await setDeleted(new Date().toISOString());
    expect(await contextUser()).toBeNull();
    expect(await directUser()).toBeNull();
  });
});
