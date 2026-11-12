// Absence excuses (#3735) against the real database.
//
// The unit suite drives `EventExcuseService` against a mocked repository, so
// it can't see what `decide_event_excuse` and `withdraw_event_excuse` write to
// `event_attendance`. That is where an excuse turns into how a member is
// counted, so it is pinned here: approval writes EXCUSED (over ABSENT, never
// over PRESENT), a late decline marks ABSENT, a decided excuse can't be
// decided again, and withdrawing an approved one removes its EXCUSED row.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568).

import { randomUUID } from 'node:crypto';
import { SupabaseEventExcuseRepository } from '../../src/infrastructure/supabase/repositories/supabase-event-excuse.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('Event excuses decide and withdraw atomically', () => {
  let supabase: FrappSupabaseClient;
  let repo: SupabaseEventExcuseRepository;

  const chapterId = randomUUID();
  const otherChapterId = randomUUID();
  const officerId = randomUUID();
  const memberIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const eventId = randomUUID();

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    repo = new SupabaseEventExcuseRepository(supabase);

    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert([
          {
            id: chapterId,
            name: `excuses-${chapterId.slice(0, 8)}`,
            university: 'Integration Test University',
          },
          {
            id: otherChapterId,
            name: `excuses-${otherChapterId.slice(0, 8)}`,
            university: 'Integration Test University',
          },
        ] as never)
      ).error,
    );
    assertOk(
      'users',
      (
        await supabase.from('users').insert(
          [officerId, ...memberIds].map((id) => ({
            id,
            supabase_auth_id: randomUUID(),
            email: `excuse-${id}@example.test`,
            display_name: 'Excuse Test',
          })) as never,
        )
      ).error,
    );
    const start = new Date(Date.now() - 3 * 60 * 60 * 1000);
    assertOk(
      'events',
      (
        await supabase.from('events').insert({
          id: eventId,
          chapter_id: chapterId,
          name: 'Chapter meeting',
          start_time: start.toISOString(),
          end_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
          point_value: 10,
          is_mandatory: true,
        } as never)
      ).error,
    );
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('event_excuses').delete().eq('event_id', eventId);
    await supabase.from('event_attendance').delete().eq('event_id', eventId);
    await supabase.from('events').delete().eq('id', eventId);
    await supabase
      .from('users')
      .delete()
      .in('id', [officerId, ...memberIds]);
    await supabase
      .from('chapters')
      .delete()
      .in('id', [chapterId, otherChapterId]);
  });

  const submit = async (userId: string) => {
    const excuse = await repo.create({
      chapter_id: chapterId,
      event_id: eventId,
      user_id: userId,
      reason: 'Away game',
    });
    if (!excuse) throw new Error('create returned null');
    return excuse;
  };

  const attendanceOf = async (userId: string) => {
    const { data, error } = await supabase
      .from('event_attendance')
      .select('status, excuse_reason, marked_by')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle();
    assertOk('attendance read', error);
    return data;
  };

  it('approval writes EXCUSED over the ABSENT the sweep wrote, once', async () => {
    const [member] = memberIds;
    const excuse = await submit(member);
    // A second excuse for the same event is refused (the service's 409).
    expect(
      await repo.create({
        chapter_id: chapterId,
        event_id: eventId,
        user_id: member,
        reason: 'again',
      }),
    ).toBeNull();
    await supabase
      .from('event_attendance')
      .insert({
        event_id: eventId,
        user_id: member,
        status: 'ABSENT',
      } as never);

    // Another chapter can't decide it.
    expect(
      await repo.decideAtomic(
        excuse.id,
        otherChapterId,
        'APPROVED',
        officerId,
        false,
      ),
    ).toBeNull();

    const decided = await repo.decideAtomic(
      excuse.id,
      chapterId,
      'APPROVED',
      officerId,
      false,
    );
    expect(decided).toMatchObject({
      status: 'APPROVED',
      decided_by: officerId,
    });
    expect(await attendanceOf(member)).toEqual({
      status: 'EXCUSED',
      excuse_reason: 'Away game',
      marked_by: officerId,
    });

    // Already decided: no second decision.
    expect(
      await repo.decideAtomic(
        excuse.id,
        chapterId,
        'DECLINED',
        officerId,
        true,
      ),
    ).toBeNull();
    expect((await attendanceOf(member))?.status).toBe('EXCUSED');
  });

  it('approval leaves a check-in alone', async () => {
    const member = memberIds[1];
    const excuse = await submit(member);
    await supabase
      .from('event_attendance')
      .insert({
        event_id: eventId,
        user_id: member,
        status: 'PRESENT',
      } as never);

    await repo.decideAtomic(excuse.id, chapterId, 'APPROVED', officerId, false);

    expect((await attendanceOf(member))?.status).toBe('PRESENT');
  });

  it('a late decline marks ABSENT; an early one writes nothing', async () => {
    const late = memberIds[2];
    const lateExcuse = await submit(late);
    await repo.decideAtomic(
      lateExcuse.id,
      chapterId,
      'DECLINED',
      officerId,
      true,
    );
    expect((await attendanceOf(late))?.status).toBe('ABSENT');

    const early = memberIds[3];
    const earlyExcuse = await submit(early);
    await repo.decideAtomic(
      earlyExcuse.id,
      chapterId,
      'DECLINED',
      officerId,
      false,
    );
    expect(await attendanceOf(early)).toBeNull();
  });

  it('withdrawing an approved excuse removes its EXCUSED row; a declined one stays', async () => {
    const [member] = memberIds;
    expect(await repo.withdrawAtomic(chapterId, eventId, member)).toMatchObject(
      { status: 'APPROVED' },
    );
    expect(await attendanceOf(member)).toBeNull();
    expect(
      await repo.findByEventAndUser(chapterId, eventId, member),
    ).toBeNull();

    // memberIds[3]'s excuse was declined.
    expect(
      await repo.withdrawAtomic(chapterId, eventId, memberIds[3]),
    ).toBeNull();
  });
});
