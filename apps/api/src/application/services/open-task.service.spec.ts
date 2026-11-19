import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OpenTaskService } from './open-task.service';
import { TaskAudienceService } from './task-audience.service';
import type { OpenTask } from '#domain/entities/open-task.entity';
import { TaskStatus, type Task } from '#domain/entities/task.entity';
import type { IOpenTaskRepository } from '#domain/repositories/open-task.repository.interface';
import { memberFixture } from '#test/helpers/entity-fixtures';

const CHAPTER = 'ch-1';
const OFFICER = 'officer-1';

const posting = (over: Partial<OpenTask> = {}): OpenTask => ({
  id: 'posting-1',
  chapter_id: CHAPTER,
  created_by: OFFICER,
  title: 'Drive to the store',
  description: null,
  due_date: '2099-11-21',
  due_at: null,
  point_reward: 10,
  proof_kind: 'none',
  subtask_titles: ['Get the list'],
  scope: 'chapter',
  scope_id: null,
  scope_name: null,
  scope_user_ids: null,
  status: 'open',
  claimed_task_id: null,
  claimed_by: null,
  claimed_at: null,
  meeting_id: null,
  created_at: '2026-11-18T00:00:00.000Z',
  updated_at: '2026-11-18T00:00:00.000Z',
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 'task-9',
  chapter_id: CHAPTER,
  title: 'Drive to the store',
  description: null,
  assignee_id: 'sam',
  created_by: OFFICER,
  due_date: '2099-11-21',
  due_at: null,
  status: TaskStatus.TODO,
  point_reward: 10,
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
  created_at: '2026-11-18T00:00:00.000Z',
  ...over,
});

describe('OpenTaskService (2026-11-18)', () => {
  let repo: jest.Mocked<IOpenTaskRepository>;
  let taskRepo: { findPhotos: jest.Mock };
  let tasks: {
    findById: jest.Mock;
    notifyAssigned: jest.Mock;
    releasePhotos: jest.Mock;
  };
  let notifications: { notifyUser: jest.Mock; timeZoneFor: jest.Mock };
  let roleRepo: { findByChapter: jest.Mock; findByIds: jest.Mock };
  let groupRepo: { findByChapter: jest.Mock; findMemberIds: jest.Mock };
  let service: OpenTaskService;

  beforeEach(() => {
    repo = {
      findById: jest.fn().mockResolvedValue(posting()),
      findOpen: jest.fn().mockResolvedValue([]),
      findClaimedFrom: jest.fn().mockResolvedValue(new Map()),
      create: jest.fn(async (data) => posting({ ...data, id: 'posting-1' })),
      updateOpen: jest.fn(),
      deleteOpen: jest.fn(),
      claim: jest.fn().mockResolvedValue({ ok: true, task: task() }),
      release: jest.fn(),
    };
    taskRepo = { findPhotos: jest.fn().mockResolvedValue([]) };
    tasks = {
      findById: jest.fn(async (id: string) => ({ ...task({ id }) })),
      notifyAssigned: jest.fn().mockResolvedValue(undefined),
      releasePhotos: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      timeZoneFor: jest.fn().mockResolvedValue(null),
    };
    const members = [
      memberFixture({ user_id: OFFICER, role_ids: ['role-officer'] }),
      memberFixture({ user_id: 'sam', role_ids: ['role-phil'] }),
      memberFixture({ user_id: 'alex', role_ids: ['role-phil'] }),
      memberFixture({ user_id: 'jo', role_ids: ['role-member'] }),
      memberFixture({
        user_id: 'alum',
        role_ids: ['role-alumni', 'role-phil'],
      }),
    ];
    roleRepo = {
      findByChapter: jest.fn().mockResolvedValue([
        { id: 'role-phil', name: 'Philanthropy Chair', system_key: null },
        { id: 'role-empty', name: 'Treasurer', system_key: null },
        { id: 'role-alumni', name: 'Alumni', system_key: 'ALUMNI' },
      ]),
      findByIds: jest.fn().mockResolvedValue([]),
    };
    groupRepo = {
      findByChapter: jest
        .fn()
        .mockResolvedValue([{ id: 'grp-1', name: 'Fall 2026' }]),
      findMemberIds: jest.fn().mockResolvedValue(['jo', 'alum']),
    };
    const audiences = new TaskAudienceService(
      { findByChapter: jest.fn().mockResolvedValue(members) } as never,
      roleRepo as never,
      groupRepo as never,
      { getAlumniRoleId: jest.fn().mockResolvedValue('role-alumni') } as never,
    );
    service = new OpenTaskService(
      repo,
      taskRepo as never,
      {
        findByIds: jest.fn(async (ids: string[]) =>
          ids.map((id) => ({ id, display_name: id === 'sam' ? 'Sam' : 'X' })),
        ),
      } as never,
      audiences,
      tasks as never,
      notifications as never,
    );
  });

  const create = (
    target: Parameters<OpenTaskService['create']>[0]['target'],
    over: Partial<Parameters<OpenTaskService['create']>[0]> = {},
  ) =>
    service.create({
      chapter_id: CHAPTER,
      created_by: OFFICER,
      title: '  Drive to the store ',
      due_date: '2099-11-21',
      point_reward: 10,
      subtasks: ['Get the list', ' '],
      target,
      ...over,
    });

  describe('create', () => {
    it("posts one task for a role's holders, alumni left out, and pushes them", async () => {
      const view = await create({ kind: 'role', id: 'role-phil' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Drive to the store',
          scope: 'role',
          scope_id: 'role-phil',
          scope_name: 'Philanthropy Chair',
          scope_user_ids: null,
          subtask_titles: ['Get the list'],
          point_reward: 10,
        }),
      );
      expect(view).toMatchObject({
        eligible_count: 2,
        viewer_can_claim: false,
      });
      const pushed = notifications.notifyUser.mock.calls.map((c) => c[0]);
      expect(pushed.sort()).toEqual(['alex', 'sam']);
      expect(notifications.notifyUser.mock.calls[0][2]).toMatchObject({
        title: 'Up for grabs: Drive to the store',
        category: 'tasks',
        data: { target: { screen: 'tasks', openTaskId: 'posting-1' } },
      });
      expect(notifications.notifyUser.mock.calls[0][2].body).toMatch(
        /^10 points · Due /,
      );
    });

    it('keeps the minutes it was suggested from, by id (#5562)', async () => {
      await create({ kind: 'chapter' }, { meeting_id: 'meeting-1' });
      expect(repo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ meeting_id: 'meeting-1' }),
      );
      await create({ kind: 'chapter' });
      expect(repo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ meeting_id: null }),
      );
    });

    it('posts one for anyone in the chapter, the officer not pushed', async () => {
      const view = await create({ kind: 'chapter' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'chapter', scope_id: null }),
      );
      expect(view).toMatchObject({ eligible_count: 4, viewer_can_claim: true });
      const pushed = notifications.notifyUser.mock.calls.map((c) => c[0]);
      expect(pushed.sort()).toEqual(['alex', 'jo', 'sam']);
    });

    it("keeps a group's active members, and the people listed", async () => {
      await create({ kind: 'group', id: 'grp-1' });
      expect(repo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: 'group', scope_name: 'Fall 2026' }),
      );
      await create({ kind: 'people', userIds: ['sam', 'jo', 'sam'] });
      expect(repo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: 'people',
          scope_user_ids: ['sam', 'jo'],
        }),
      );
    });

    it.each([
      [{ kind: 'role', id: 'role-empty' }, 'Nobody holds that role yet'],
      [{ kind: 'role', id: 'role-alumni' }, "Alumni don't get chapter tasks"],
      [{ kind: 'people', userIds: ['sam', 'alum'] }, 'active member'],
    ] as const)('refuses %j, writing nothing', async (target, message) => {
      await expect(
        create(target as Parameters<typeof create>[0]),
      ).rejects.toThrow(message);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('checks the fields as a task does', async () => {
      await expect(
        create({ kind: 'chapter' }, { due_at: '2099-12-30T10:00:00Z' }),
      ).rejects.toThrow('due_at must fall on due_date');
      await expect(create({ kind: 'chapter' }, { title: ' ' })).rejects.toThrow(
        'A task needs a title',
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      repo.findOpen.mockResolvedValue([
        posting({ id: 'p-anyone' }),
        posting({
          id: 'p-phil',
          scope: 'role',
          scope_id: 'role-phil',
          scope_name: 'Philanthropy (old name)',
        }),
        posting({
          id: 'p-gone',
          scope: 'group',
          scope_id: 'grp-deleted',
          scope_name: 'Spring 2025',
        }),
      ]);
    });

    it('gives a member only what they may claim', async () => {
      const views = await service.list(CHAPTER, 'jo', false);
      expect(views.map((v) => v.id)).toEqual(['p-anyone']);
    });

    it('gives an officer every open posting, with the live name or the old one', async () => {
      const views = await service.list(CHAPTER, OFFICER, true);
      expect(
        views.map((v) => [
          v.id,
          v.scope_name,
          v.eligible_count,
          v.viewer_can_claim,
        ]),
      ).toEqual([
        ['p-anyone', null, 4, true],
        ['p-phil', 'Philanthropy Chair', 2, false],
        ['p-gone', 'Spring 2025', 0, false],
      ]);
    });

    it('never offers one to an alum', async () => {
      expect(await service.list(CHAPTER, 'alum', false)).toEqual([]);
    });
  });

  describe('claim', () => {
    it('makes the task for the claimer and tells the poster', async () => {
      const view = await service.claim(CHAPTER, 'posting-1', 'sam');

      expect(repo.claim).toHaveBeenCalledWith(
        CHAPTER,
        'posting-1',
        'sam',
        OFFICER,
      );
      expect(view.id).toBe('task-9');
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        OFFICER,
        CHAPTER,
        expect.objectContaining({
          title: 'Sam claimed: Drive to the store',
          data: { target: { screen: 'tasks', taskId: 'task-9' } },
        }),
      );
    });

    it("says the posting's due time in the poster's zone", async () => {
      repo.findById.mockResolvedValue(
        posting({ due_at: '2099-11-21T23:00:00.000Z' }),
      );
      notifications.timeZoneFor.mockResolvedValue('America/New_York');

      await service.claim(CHAPTER, 'posting-1', 'sam');

      expect(notifications.timeZoneFor).toHaveBeenCalledWith(OFFICER);
      const push = notifications.notifyUser.mock.calls[0]![2] as {
        body: string;
      };
      expect(push.body).toContain('6 PM');
    });

    it('tells nobody when the poster claims it', async () => {
      await service.claim(CHAPTER, 'posting-1', OFFICER);
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });

    it('answers 409 when another claim got there first', async () => {
      repo.claim.mockResolvedValue({ ok: false, reason: 'taken' });
      await expect(service.claim(CHAPTER, 'posting-1', 'sam')).rejects.toThrow(
        new ConflictException('Someone already claimed this'),
      );
      repo.findById.mockResolvedValue(posting({ status: 'claimed' }));
      await expect(service.claim(CHAPTER, 'posting-1', 'sam')).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses a member the posting is not for, and an alum, with 403', async () => {
      repo.findById.mockResolvedValue(
        posting({ scope: 'role', scope_id: 'role-phil' }),
      );
      await expect(service.claim(CHAPTER, 'posting-1', 'jo')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.claim(CHAPTER, 'posting-1', 'alum')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.claim).not.toHaveBeenCalled();
    });

    it('answers 404 for no such posting', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.claim(CHAPTER, 'nope', 'sam')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assign', () => {
    it('hands it to any active member, eligible or not, with the assignment push', async () => {
      repo.findById.mockResolvedValue(
        posting({ scope: 'role', scope_id: 'role-phil' }),
      );
      repo.claim.mockResolvedValue({
        ok: true,
        task: task({ assignee_id: 'jo' }),
      });

      await service.assign(CHAPTER, 'posting-1', OFFICER, 'jo');

      expect(repo.claim).toHaveBeenCalledWith(
        CHAPTER,
        'posting-1',
        'jo',
        OFFICER,
      );
      expect(tasks.notifyAssigned).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'task-9' }),
        OFFICER,
      );
    });

    it('refuses an alum or a non-member', async () => {
      await expect(
        service.assign(CHAPTER, 'posting-1', OFFICER, 'alum'),
      ).rejects.toThrow(BadRequestException);
      expect(repo.claim).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('gives it back and drops the photos the task held', async () => {
      taskRepo.findPhotos.mockResolvedValue([
        { storage_path: 'chapters/ch-1/tasks/ref.jpg', kind: 'reference' },
      ]);
      repo.release.mockResolvedValue({ ok: true, posting: posting() });

      const view = await service.release(CHAPTER, 'task-9', 'sam');

      expect(repo.release).toHaveBeenCalledWith(CHAPTER, 'task-9', 'sam');
      expect(tasks.releasePhotos).toHaveBeenCalledWith(CHAPTER, [
        'chapters/ch-1/tasks/ref.jpg',
      ]);
      expect(view).toMatchObject({ id: 'posting-1', viewer_can_claim: true });
    });

    it.each([
      ['missing', NotFoundException],
      ['not_assignee', ForbiddenException],
      ['done', ConflictException],
    ] as const)('answers %s with its status', async (reason, error) => {
      repo.release.mockResolvedValue({ ok: false, reason });
      await expect(service.release(CHAPTER, 'task-9', 'sam')).rejects.toThrow(
        error,
      );
      expect(tasks.releasePhotos).not.toHaveBeenCalled();
    });
  });

  describe('update and delete', () => {
    it('edits an open posting', async () => {
      repo.updateOpen.mockResolvedValue(posting({ title: 'Drive to Costco' }));

      await service.update(CHAPTER, 'posting-1', OFFICER, {
        title: ' Drive to Costco ',
        point_reward: 0,
        subtasks: ['A', 'B'],
      });

      expect(repo.updateOpen).toHaveBeenCalledWith(CHAPTER, 'posting-1', {
        title: 'Drive to Costco',
        point_reward: null,
        subtask_titles: ['A', 'B'],
      });
    });

    it('refuses null proof or checklist with 400, never a failed write', async () => {
      await expect(
        service.update(CHAPTER, 'posting-1', OFFICER, {
          proof_kind: null as unknown as undefined,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.update(CHAPTER, 'posting-1', OFFICER, {
          subtasks: null as unknown as undefined,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.updateOpen).not.toHaveBeenCalled();
    });

    it('refuses an edit or a delete once claimed, with 409', async () => {
      repo.findById.mockResolvedValue(posting({ status: 'claimed' }));
      await expect(
        service.update(CHAPTER, 'posting-1', OFFICER, { title: 'X' }),
      ).rejects.toThrow(ConflictException);
      repo.deleteOpen.mockResolvedValue(false);
      await expect(service.delete(CHAPTER, 'posting-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('answers 409 when a claim lands mid-edit', async () => {
      repo.updateOpen.mockResolvedValue(null);
      repo.findById
        .mockResolvedValueOnce(posting())
        .mockResolvedValueOnce(posting({ status: 'claimed' }));
      await expect(
        service.update(CHAPTER, 'posting-1', OFFICER, { title: 'X' }),
      ).rejects.toThrow(ConflictException);
    });

    it('deletes an open posting, and answers 404 for none', async () => {
      repo.deleteOpen.mockResolvedValue(true);
      await expect(
        service.delete(CHAPTER, 'posting-1'),
      ).resolves.toBeUndefined();
      repo.deleteOpen.mockResolvedValue(false);
      repo.findById.mockResolvedValue(null);
      await expect(service.delete(CHAPTER, 'posting-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
