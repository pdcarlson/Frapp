// What a member assigned, a task for everyone counted once (#5492), against a
// real Postgres and PostgREST.
//
// The unit specs prove what the repository asks for. This proves what
// PostgREST does with it: that `tasks!inner` with a filter on the embed keeps
// only the groups with a copy not yet confirmed, that the embed's own limit
// caps the embedded rows and not the groups, and that `groupless` leaves out
// every copy. The tenant-scope harness resolves no join, so it can't.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack
// with `20261118043407` applied; skips cleanly without a stack).

import { randomUUID } from 'node:crypto';
import { SupabaseTaskRepository } from '../../src/infrastructure/supabase/repositories/supabase-task.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { TaskStatus } from '../../src/domain/entities/task.entity';
import type { Task } from '../../src/domain/entities/task.entity';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration(
  'A creator’s unfinished groups against live PostgREST (#5492)',
  () => {
    let supabase: FrappSupabaseClient;
    let tasks: SupabaseTaskRepository;
    const chapterId = randomUUID();
    const officerId = randomUUID();
    const memberId = randomUUID();
    /** Oldest first. */
    const groupIds: string[] = [];

    const assertOk = (label: string, error: unknown) => {
      if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
    };

    const makeGroup = async (title: string): Promise<Task[]> =>
      tasks.createGroup({
        chapter_id: chapterId,
        created_by: officerId,
        audience: 'everyone',
        target_id: null,
        target_name: null,
        assignee_ids: [officerId, memberId],
        title,
        description: null,
        due_date: '2026-12-01',
        due_at: null,
        point_reward: null,
        proof_kind: 'none',
        subtask_titles: [],
      });

    const confirm = async (copy: Task) =>
      assertOk(
        'confirm',
        (
          await supabase
            .from('tasks')
            .update({
              status: TaskStatus.COMPLETED,
              completed_at: '2026-11-18T00:00:00.000Z',
              confirmed_at: '2026-11-18T00:00:00.000Z',
              points_awarded: true,
            })
            .eq('id', copy.id)
        ).error,
      );

    beforeAll(async () => {
      supabase = createServiceRoleClient();
      tasks = new SupabaseTaskRepository(supabase);
      assertOk(
        'chapter',
        (
          await supabase
            .from('chapters')
            .insert({ id: chapterId, name: 'Groups', university: 'U' })
        ).error,
      );
      for (const id of [officerId, memberId]) {
        assertOk(
          'user',
          (
            await supabase.from('users').insert({
              id,
              supabase_auth_id: randomUUID(),
              email: `${id}@example.test`,
            })
          ).error,
        );
      }
      // Three groups, oldest first: one still open, one finished (every copy
      // confirmed), one with a copy confirmed and one still open.
      for (const title of ['Open', 'Finished', 'Half']) {
        const copies = await makeGroup(title);
        groupIds.push(copies[0].group_id!);
        if (title === 'Finished')
          for (const copy of copies) await confirm(copy);
        if (title === 'Half') await confirm(copies[0]);
      }
      assertOk(
        'one-person task',
        (
          await supabase.from('tasks').insert({
            chapter_id: chapterId,
            title: 'Solo',
            assignee_id: memberId,
            created_by: officerId,
            due_date: '2026-12-01',
            status: TaskStatus.TODO,
          })
        ).error,
      );
    });

    afterAll(async () => {
      if (!supabase) return;
      await supabase.from('chapters').delete().eq('id', chapterId);
      await supabase.from('users').delete().in('id', [officerId, memberId]);
    });

    it('keeps only groups with a copy not yet confirmed, newest first', async () => {
      const [open, , half] = groupIds;
      const groups = await tasks.findUnfinishedGroupsByCreator(
        chapterId,
        officerId,
        25,
      );

      expect(groups.map((group) => group.id)).toEqual([half, open]);
      for (const group of groups) expect(group).not.toHaveProperty('tasks');
    });

    it('caps the groups, not the copies embedded to filter on', async () => {
      const [, , half] = groupIds;
      const groups = await tasks.findUnfinishedGroupsByCreator(
        chapterId,
        officerId,
        1,
      );

      expect(groups.map((group) => group.id)).toEqual([half]);
    });

    it('reads one-person tasks apart from every copy', async () => {
      const solo = await tasks.findByChapter(chapterId, {
        createdBy: officerId,
        groupless: true,
      });

      expect(solo.map((task) => task.title)).toEqual(['Solo']);
    });
  },
);
