import { ActivityService } from './activity.service';
import { TaskService } from './task.service';
import { SupabaseTaskRepository } from '../../infrastructure/supabase/repositories/supabase-task.repository';
import { SupabaseOpenTaskRepository } from '../../infrastructure/supabase/repositories/supabase-open-task.repository';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  CHAPTER_A,
  createTenantHarness,
  inA,
  inB,
  type Row,
} from '#test/helpers/tenant-scope.harness';

/**
 * How many reads one Activity load makes (#5746). The task section runs the
 * real `TaskService` over the real Supabase repositories on the tenant-scope
 * fake, so every PostgREST request it would send is counted. The other
 * sections' services and repositories are stubs, each call counted as one
 * read: what they cost is theirs to measure, and this spec only holds the
 * line on the count as a whole.
 */

const ME = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-10T18:00:00.000Z');
const GROUP = '0a000000-0000-4000-8000-0000000000f1';

const taskRow = (id: string, columns: Row): Row => ({
  id,
  title: 'Book the venue',
  description: null,
  assignee_id: ME,
  created_by: OTHER,
  due_date: '2026-11-12',
  due_at: null,
  status: 'TODO',
  point_reward: 5,
  points_awarded: false,
  completed_at: null,
  confirmed_at: null,
  sent_back_at: null,
  proof_kind: 'none',
  proof_link: null,
  sent_back_reason: null,
  completion_note: null,
  series_id: null,
  occurrence_date: null,
  group_id: null,
  meeting_id: null,
  created_at: '2026-11-01T00:00:00.000Z',
  ...columns,
});

/** Every row in chapter A, and its twin in chapter B. */
const twins = (rows: [string, Row][]): Row[] =>
  rows.flatMap(([id, columns]) =>
    (['a', 'b'] as const).map((prefix) =>
      (prefix === 'a' ? inA : inB)(
        taskRow(`${prefix}${id}`, {
          ...columns,
          // A group is its chapter's own, as each task is.
          group_id:
            typeof columns.group_id === 'string'
              ? `${prefix}${columns.group_id}`
              : null,
        }),
      ),
    ),
  );

const seed = () => ({
  tasks: twins([
    // Mine, open, due this week.
    ['-open', { title: 'Open task' }],
    // Mine, a copy of a task for everyone.
    ['-copy-mine', { title: 'Everyone', group_id: GROUP, created_by: ME }],
    // Mine, done and confirmed this week.
    [
      '-done-confirmed',
      {
        title: 'Done',
        status: 'COMPLETED',
        completed_at: '2026-11-09T10:00:00.000Z',
        confirmed_at: '2026-11-09T12:00:00.000Z',
        points_awarded: true,
      },
    ],
    // Mine, done this week, waiting on an officer.
    [
      '-done-waiting',
      {
        title: 'Done, waiting',
        status: 'COMPLETED',
        completed_at: '2026-11-09T11:00:00.000Z',
      },
    ],
    // Mine, done last week and confirmed: in neither list nor count.
    [
      '-done-old',
      {
        title: 'Old',
        status: 'COMPLETED',
        completed_at: '2026-11-01T10:00:00.000Z',
        confirmed_at: '2026-11-01T12:00:00.000Z',
        points_awarded: true,
      },
    ],
    // Mine, a copy of the same task, done before the week began and still
    // waiting on an officer: in the own read (not confirmed), but neither
    // open nor done this week. In the Archive, with its group.
    [
      '-copy-mine-done-early',
      {
        title: 'Everyone, done early',
        group_id: GROUP,
        created_by: ME,
        status: 'COMPLETED',
        completed_at: '2026-11-05T10:00:00.000Z',
      },
    ],
    // Someone else's, done, waiting on a confirm; made by me.
    [
      '-theirs-waiting',
      {
        title: 'Theirs, waiting',
        assignee_id: OTHER,
        created_by: ME,
        status: 'COMPLETED',
        completed_at: '2026-11-09T09:00:00.000Z',
      },
    ],
    // Someone else's copy of my task for everyone.
    [
      '-copy-theirs',
      {
        title: 'Everyone',
        assignee_id: OTHER,
        group_id: GROUP,
        created_by: ME,
      },
    ],
  ]),
  task_groups: [
    inA({
      id: `a${GROUP}`,
      created_by: ME,
      audience: 'everyone',
      target_id: null,
      target_name: null,
      created_at: '2026-11-01T00:00:00.000Z',
      tasks: [{ id: 'copy', points_awarded: false }],
    }),
    inB({
      id: `b${GROUP}`,
      created_by: ME,
      audience: 'everyone',
      target_id: null,
      target_name: null,
      created_at: '2026-11-01T00:00:00.000Z',
      tasks: [{ id: 'copy', points_awarded: false }],
    }),
  ],
});

function load(permissions: string[]) {
  const harness = createTenantHarness({
    tables: seed(),
    collisionExempt: { tasks: ['group_id'] },
  });
  const taskRepo = new SupabaseTaskRepository(harness.client);
  const openTaskRepo = new SupabaseOpenTaskRepository(harness.client);
  const stub = <T>(value: T) => jest.fn().mockResolvedValue(value);
  const userRepo = {
    findDisplayIdentitiesByIds: stub([
      { id: ME, display_name: 'Me Member', avatar_url: null },
      { id: OTHER, display_name: 'Other Member', avatar_url: null },
    ]),
  };
  const audiences = { liveNames: stub(new Map()) };
  const taskService = new TaskService(
    taskRepo,
    {} as never,
    userRepo as never,
    {} as never,
    {} as never,
    {} as never,
    audiences as never,
    openTaskRepo,
  );
  // Every other read the page makes, one PostgREST request each, except a
  // read by ids given none, which the repositories answer without a request.
  const reads = {
    findByChapterFiltered: stub([]),
    findByChapter: stub([]),
    findCreatedBy: stub([]),
    getChannels: stub([{ id: 'channel-1', name: 'general', type: 'PUBLIC' }]),
    listBlockedUserIds: stub([]),
    getEffectivePermissions: stub(permissions),
    getAlumniRoleId: stub('role-alumni'),
    findCardsByChapter: stub([]),
    findActionsOnMessages: stub([]),
    findAllActionsOnMessages: stub([]),
    linksListFor: stub([]),
    remindersListFor: stub([]),
    membersByChapter: stub([]),
    findByUserAndChapter: stub({ user_id: ME, role_ids: ['role-member'] }),
    findByUserForEvents: stub([]),
    findAnswered: stub([]),
    findUnreadStart: stub(null),
    findReads: stub([]),
    findSnoozes: stub([]),
  };
  const service = new ActivityService(
    taskService,
    { findByChapterFiltered: reads.findByChapterFiltered } as never,
    {
      findByChapter: reads.findByChapter,
      findCreatedBy: reads.findCreatedBy,
      checkInNeedsCode: jest.fn().mockResolvedValue(false),
    } as never,
    { getChannels: reads.getChannels } as never,
    { listBlockedUserIds: reads.listBlockedUserIds } as never,
    {
      getEffectivePermissions: reads.getEffectivePermissions,
      getAlumniRoleId: reads.getAlumniRoleId,
    } as never,
    { listFor: reads.linksListFor } as never,
    { listFor: reads.remindersListFor } as never,
    { findCardsByChapter: reads.findCardsByChapter } as never,
    {
      findActionsOnMessages: reads.findActionsOnMessages,
      findAllActionsOnMessages: reads.findAllActionsOnMessages,
    } as never,
    userRepo as never,
    {
      findByChapter: reads.membersByChapter,
      findByUserAndChapter: reads.findByUserAndChapter,
    } as never,
    { findByUserForEvents: reads.findByUserForEvents } as never,
    {
      findUnreadStart: reads.findUnreadStart,
      findReads: reads.findReads,
      findSnoozes: reads.findSnoozes,
    } as never,
    { findAnswered: reads.findAnswered } as never,
    { readersOf: jest.fn() } as never,
  );
  const enabled: Record<string, boolean> = {
    tasks: true,
    events: true,
    polls: true,
    hours: true,
  };
  return {
    harness,
    archive: () => service.getArchive(CHAPTER_A, ME, enabled, { now: NOW }),
    run: () => service.getActivity(CHAPTER_A, ME, enabled, { now: NOW }),
    get taskRequests() {
      return harness.ops.length;
    },
    get otherReads() {
      return [...Object.values(reads), userRepo.findDisplayIdentitiesByIds]
        .flatMap((read) => read.mock.calls as unknown[][])
        .filter(([first]) => !(Array.isArray(first) && first.length === 0))
        .length;
    },
  };
}

describe('ActivityService reads per load (#5746)', () => {
  // Before #5746 the task section alone made 29 requests for this officer
  // and 9 for this member (43 and 23 for the page, counting the other
  // sections' 14): every list read its
  // subtasks, photos, series, groups and open tasks, and ended on an empty
  // page, and two counts went on their own.
  it('an officer with tasks:manage: the task section in 13 requests', async () => {
    const page = load([
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.TASKS_MANAGE,
    ]);
    const view = await page.harness.expectTenantScoped(CHAPTER_A, () =>
      page.run(),
    );

    // One request each for its own tasks (uncapped, counted) and the
    // confirmations with their count; what it assigned (2: capped, so not
    // counted, and a short page reads on to an empty one); their groups once
    // (3: the groups, and the copies' paged read, which still ends on an
    // empty page); what it assigned as items (6: one-person tasks (2),
    // groups, copies (2), and one copy whole).
    expect(page.taskRequests).toBe(13);
    expect(page.taskRequests + page.otherReads).toBe(27);
    // What the page shows is what it showed before.
    expect(
      view.needs_you.tasks.map((task) => [task.title, task.group?.total]),
    ).toEqual([
      ['Open task', undefined],
      ['Everyone', 3],
    ]);
    expect(view.needs_you.task_confirmations.map((task) => task.title)).toEqual(
      ['Theirs, waiting'],
    );
    expect(view.needs_you_count).toBe(3);
    // Done this week, confirmed or not; not last week's, nor one done before
    // the week that still waits on a confirm.
    expect(view.week.tasks).toEqual({ done: 2, total: 4 });
    expect(view.made_by_you.tasks.map((task) => task.title)).toEqual([
      'Theirs, waiting',
      'Everyone',
      'Everyone, done early',
      'Everyone',
    ]);
    expect(view.made_by_you.task_items.map((item) => item.kind)).toEqual([
      'group',
      'task',
    ]);
    expect(view.unavailable).toEqual([]);
  });

  it('a member: the task section in 4 requests, only their own tasks', async () => {
    const page = load([SystemPermissions.MEMBERS_VIEW]);
    const view = await page.harness.expectTenantScoped(CHAPTER_A, () =>
      page.run(),
    );

    // Their tasks with this week's done ones, in one read, and the group.
    expect(page.taskRequests).toBe(4);
    expect(page.taskRequests + page.otherReads).toBe(18);
    const [ownRead] = page.harness.ops;
    expect(ownRead.filters).toContainEqual(
      expect.objectContaining({ column: 'assignee_id', value: ME }),
    );
    expect(view.needs_you.tasks.map((task) => task.title)).toEqual([
      'Open task',
      'Everyone',
    ]);
    expect(view.needs_you.task_confirmations).toEqual([]);
    expect(view.needs_you_count).toBe(2);
    expect(view.week.tasks).toEqual({ done: 2, total: 4 });
    expect(view.made_by_you.tasks).toEqual([]);
    expect(view.made_by_you.task_items).toEqual([]);
  });

  // Before #5746: 8 requests for this member's Archive tasks.
  it('the Archive draws a finished task for everyone with its group, in 5 requests', async () => {
    const page = load([SystemPermissions.MEMBERS_VIEW]);

    const archive = await page.harness.expectTenantScoped(CHAPTER_A, () =>
      page.archive(),
    );

    expect(
      archive.tasks.map((task) => [task.title, task.group?.total ?? null]),
    ).toEqual([
      ['Done', null],
      ['Done, waiting', null],
      ['Everyone, done early', 3],
      ['Old', null],
    ]);
    // Their finished tasks, then the kept ones' groups (3).
    expect(page.taskRequests).toBe(5);
  });
});
