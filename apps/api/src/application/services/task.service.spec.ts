import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TaskService, type CreateTaskInput } from './task.service';
import { TASK_REPOSITORY } from '#domain/repositories/task.repository.interface';
import type { ITaskRepository } from '#domain/repositories/task.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import {
  Task,
  TaskStatus,
  type TaskPhoto,
  type TaskPhotoKind,
} from '#domain/entities/task.entity';
import type { Member } from '#domain/entities/member.entity';
import type { User } from '#domain/entities/user.entity';
import { NotificationService } from './notification.service';
import { ChatService } from './chat.service';
import { RbacService } from './rbac.service';
import { TaskAudienceService } from './task-audience.service';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { CHAPTER_GROUP_REPOSITORY } from '#domain/repositories/chapter-group.repository.interface';
import type { IChapterGroupRepository } from '#domain/repositories/chapter-group.repository.interface';
import { ROLE_TIER_REPOSITORY } from '#domain/repositories/role-tier.repository.interface';
import type { IRoleTierRepository } from '#domain/repositories/role-tier.repository.interface';
import { accessHolderFromRoles } from '#domain/utils/channel-access';
import { OPEN_TASK_REPOSITORY } from '#domain/repositories/open-task.repository.interface';
import type { IOpenTaskRepository } from '#domain/repositories/open-task.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import {
  TASK_PROOF_REQUIRED_CODE,
  TASK_RESUBMIT_NEEDS_CHANGE_CODE,
} from '@repo/validation';
import { memberFixture, userFixture } from '#test/helpers/entity-fixtures';

describe('TaskService', () => {
  let service: TaskService;
  let mockTaskRepo: jest.Mocked<ITaskRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockUserRepo: jest.Mocked<Pick<IUserRepository, 'findByIds'>>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockChatService: jest.Mocked<Pick<ChatService, 'sendMessage'>>;
  let mockRbac: jest.Mocked<
    Pick<
      RbacService,
      | 'getAlumniRoleId'
      | 'getChannelAccessHolder'
      | 'findUserIdsWithPermissions'
    >
  >;
  let mockTierRepo: jest.Mocked<Pick<IRoleTierRepository, 'findByChapter'>>;
  let mockRoleRepo: jest.Mocked<
    Pick<IRoleRepository, 'findByChapter' | 'findByIds'>
  >;
  let mockGroupRepo: jest.Mocked<
    Pick<
      IChapterGroupRepository,
      'findByChapter' | 'findMemberIds' | 'findById'
    >
  >;
  let mockOpenTaskRepo: jest.Mocked<
    Pick<IOpenTaskRepository, 'findClaimedFrom'>
  >;
  let mockStorage: jest.Mocked<
    Pick<
      IStorageProvider,
      | 'getSignedUploadUrl'
      | 'getSignedDownloadUrl'
      | 'listFiles'
      | 'deleteFiles'
    >
  >;

  const baseTask: Task = {
    id: 'task-1',
    chapter_id: 'ch-1',
    title: 'Test Task',
    description: 'Test description',
    assignee_id: 'user-1',
    created_by: 'admin-1',
    due_date: '2099-03-15',
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
    followed_by: null,
    created_at: '2026-02-26T00:00:00.000Z',
  };

  /**
   * A task as the read paths return it (#1051). `create` deliberately does not
   * go through `toDisplayStatus`, which is why its assertions still compare
   * against the bare entity.
   */
  const asView = (task: Task) => ({ ...task, stored_status: task.status });

  const baseMember: Member = memberFixture({
    role_ids: ['role-1'],
    has_completed_onboarding: true,
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  });

  beforeEach(async () => {
    mockTaskRepo = {
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([]),
      findByChapter: jest.fn(),
      findSince: jest.fn(),
      countByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateIfMatches: jest.fn(),
      confirmCompletionAtomic: jest.fn(),
      reopenCompletion: jest.fn(),
      delete: jest.fn(),
      findSubtasks: jest.fn().mockResolvedValue([]),
      createSubtasks: jest.fn().mockResolvedValue([]),
      setSubtaskDone: jest.fn(),
      deleteSubtask: jest.fn(),
      updateUnconfirmed: jest.fn(),
      releaseReminderClaims: jest.fn().mockResolvedValue(undefined),
      isPhotoPathInUse: jest.fn().mockResolvedValue(false),
      findPhotos: jest.fn().mockResolvedValue([]),
      createPhotos: jest.fn().mockResolvedValue([]),
      deletePhotos: jest.fn().mockResolvedValue([]),
      createSeries: jest.fn(),
      findSeries: jest.fn().mockResolvedValue([]),
      findLatestSeriesCopy: jest.fn(),
      updateSeriesIfNext: jest.fn(),
      hasCheckedSubtask: jest.fn().mockResolvedValue(false),
      createGroup: jest.fn(),
      findGroups: jest.fn().mockResolvedValue([]),
      findGroupCopies: jest.fn().mockResolvedValue([]),
      findUnfinishedGroupsByCreator: jest.fn().mockResolvedValue([]),
      // A projection of the copies: whatever `findGroupCopies` is serving.
      findGroupCopyStates: jest.fn((chapterId: string, ids: string[]) =>
        mockTaskRepo.findGroupCopies(chapterId, ids),
      ),
      deleteGroup: jest.fn().mockResolvedValue(undefined),
      deleteGroupCopies: jest.fn().mockResolvedValue([]),
      setGroupFollower: jest.fn().mockResolvedValue(undefined),
    };
    mockRbac = {
      getAlumniRoleId: jest.fn().mockResolvedValue(null),
      getChannelAccessHolder: jest
        .fn()
        .mockResolvedValue(accessHolderFromRoles([])),
      findUserIdsWithPermissions: jest.fn().mockResolvedValue([]),
    };
    mockTierRepo = {
      findByChapter: jest.fn().mockResolvedValue([]),
    };
    mockRoleRepo = {
      findByChapter: jest.fn().mockResolvedValue([]),
      findByIds: jest.fn().mockResolvedValue([]),
    };
    mockGroupRepo = {
      findByChapter: jest.fn().mockResolvedValue([]),
      findMemberIds: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
    };
    mockOpenTaskRepo = {
      findClaimedFrom: jest.fn().mockResolvedValue(new Map()),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByUser: jest.fn(),
      findChapterMemberIdentities: jest.fn(),
      transferPresidencyAtomic: jest.fn(),
      claimPresidencyAtomic: jest.fn(),
      setRoleIds: jest.fn(),
      setSelfAssignedRole: jest.fn(),
    };

    mockUserRepo = {
      findByIds: jest.fn().mockResolvedValue([]),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    mockStorage = {
      getSignedUploadUrl: jest.fn().mockResolvedValue('https://upload'),
      getSignedDownloadUrl: jest.fn().mockResolvedValue('https://view'),
      listFiles: jest.fn().mockResolvedValue([]),
      deleteFiles: jest.fn().mockResolvedValue(undefined),
    };

    mockChatService = {
      sendMessage: jest.fn().mockResolvedValue({
        message: { id: 'msg-1' },
        deduplicated: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        { provide: TASK_REPOSITORY, useValue: mockTaskRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: ChatService, useValue: mockChatService },
        { provide: STORAGE_PROVIDER, useValue: mockStorage },
        { provide: RbacService, useValue: mockRbac },
        TaskAudienceService,
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: CHAPTER_GROUP_REPOSITORY, useValue: mockGroupRepo },
        { provide: ROLE_TIER_REPOSITORY, useValue: mockTierRepo },
        { provide: OPEN_TASK_REPOSITORY, useValue: mockOpenTaskRepo },
      ],
    }).compile();

    service = module.get(TaskService);
  });

  describe('a task for a tier, and a group following a task (#5473)', () => {
    const EXEC = 'aaaaaaaa-0000-4000-8000-000000000001';
    const FOLLOWER = `tier:${EXEC}`;
    const execRole = {
      id: 'role-pres',
      chapter_id: 'ch-1',
      name: 'President',
      tier_id: EXEC,
      permissions: [],
      system_key: null,
    };
    const member = (userId: string, roleIds: string[]) =>
      memberFixture({ ...baseMember, user_id: userId, role_ids: roleIds });
    /** Who holds what: a and b in the Exec board, c a member, d an alum. */
    const holds: Record<string, string[]> = {
      'admin-1': ['role-pres'],
      'exec-2': ['role-pres'],
      'user-1': ['role-1'],
      'alum-1': ['role-alumni'],
    };

    beforeEach(() => {
      mockMemberRepo.findByChapter.mockResolvedValue(
        Object.entries(holds).map(([id, roles]) => member(id, roles)),
      );
      mockMemberRepo.findByUserAndChapter.mockImplementation((userId) =>
        Promise.resolve(holds[userId] ? member(userId, holds[userId]) : null),
      );
      mockRbac.getAlumniRoleId.mockResolvedValue('role-alumni');
      mockRbac.getChannelAccessHolder.mockImplementation((_c, m) =>
        Promise.resolve(
          accessHolderFromRoles(
            (m?.role_ids ?? []).map((id) =>
              id === 'role-pres'
                ? execRole
                : {
                    id,
                    tier_id: null,
                    permissions: [],
                    system_key: id === 'role-alumni' ? 'ALUMNI' : null,
                  },
            ),
          ),
        ),
      );
      mockRoleRepo.findByChapter.mockResolvedValue([execRole] as never);
      mockTierRepo.findByChapter.mockResolvedValue([
        { id: EXEC, name: 'Exec board' },
      ] as never);
    });

    it('gives everyone holding a role in a tier a copy, named for the tier', async () => {
      mockTaskRepo.createGroup.mockResolvedValue([
        { ...baseTask, id: 'c1', assignee_id: 'admin-1', group_id: 'g1' },
        { ...baseTask, id: 'c2', assignee_id: 'exec-2', group_id: 'g1' },
      ]);
      const result = await service.create({
        chapter_id: 'ch-1',
        title: 'Plan the retreat',
        audience: 'everyone',
        audience_tier_id: EXEC,
        created_by: 'admin-1',
        due_date: '2099-03-15',
      });
      expect(mockTaskRepo.createGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          audience: 'tier',
          target_id: EXEC,
          target_name: 'Exec board',
          assignee_ids: ['admin-1', 'exec-2'],
          followed_by: null,
        }),
      );
      expect(result.group).toMatchObject({
        audience: 'tier',
        target_name: 'Exec board',
        total: 2,
      });
    });

    it('refuses a tier of another chapter, and a tier with a role and group', async () => {
      const base = {
        chapter_id: 'ch-1',
        title: 'Plan the retreat',
        audience: 'everyone' as const,
        created_by: 'admin-1',
        due_date: '2099-03-15',
      };
      await expect(
        service.create({ ...base, audience_tier_id: 'other-tier' }),
      ).rejects.toThrow("That tier isn't in this chapter");
      await expect(
        service.create({
          ...base,
          audience_tier_id: EXEC,
          audience_role_id: 'role-1',
        }),
      ).rejects.toThrow('Send one of audience_role_id');
      expect(mockTaskRepo.createGroup).not.toHaveBeenCalled();
    });

    it('keeps the group it is from when the creator is in it', async () => {
      mockTaskRepo.create.mockResolvedValue({
        ...baseTask,
        followed_by: FOLLOWER,
      });
      await service.create({
        chapter_id: 'ch-1',
        title: 'Book the venue',
        assignee_id: 'user-1',
        followed_by: FOLLOWER.toUpperCase().replace('TIER', 'tier'),
        created_by: 'admin-1',
        due_date: '2099-03-15',
      });
      expect(mockTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ followed_by: FOLLOWER }),
      );
    });

    it.each([
      ['a group the creator is not in', 'user-1', FOLLOWER, "you're in"],
      [
        'a tier of no chapter',
        'admin-1',
        'tier:bbbbbbbb-0000-4000-8000-000000000001',
        "can't be what a task is from",
      ],
      ['an entry that is not one', 'admin-1', 'exec board', 'followed_by is'],
    ])('refuses %s, writing nothing', async (_, creator, entry, message) => {
      await expect(
        service.create({
          chapter_id: 'ch-1',
          title: 'Book the venue',
          assignee_id: 'user-1',
          followed_by: entry,
          created_by: creator,
          due_date: '2099-03-15',
        }),
      ).rejects.toThrow(message);
      expect(mockTaskRepo.create).not.toHaveBeenCalled();
    });

    it('refuses a follower on a repeating task', async () => {
      await expect(
        service.create({
          chapter_id: 'ch-1',
          title: 'Take out the trash',
          assignee_id: 'user-1',
          followed_by: FOLLOWER,
          recurrence_rule: 'FREQ=WEEKLY',
          created_by: 'admin-1',
          due_date: '2099-03-15',
        }),
      ).rejects.toThrow("A repeating task can't be from a group yet.");
    });

    it("lists a member's own tasks and the ones their groups follow, without the proof", async () => {
      const followed: Task = {
        ...baseTask,
        id: 'followed',
        assignee_id: 'user-1',
        followed_by: FOLLOWER,
        status: TaskStatus.COMPLETED,
        proof_kind: 'photo',
        proof_link: 'https://example.test/proof',
      };
      mockTaskRepo.findByChapter.mockResolvedValue([followed]);
      mockTaskRepo.findPhotos.mockResolvedValue([
        { id: 'p-ref', task_id: 'followed', kind: 'reference', position: 0 },
        { id: 'p-proof', task_id: 'followed', kind: 'proof', position: 0 },
      ] as never);
      const follows = await service.followEntriesOf('ch-1', 'exec-2');
      const [view] = await service.list('ch-1', 'exec-2', false, {}, follows);

      expect(follows).toContain(FOLLOWER);
      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          assigneeId: 'exec-2',
          orFollowedBy: follows,
        }),
      );
      expect(view.proof_link).toBeNull();
      expect(view.photos?.map((photo) => photo.id)).toEqual(['p-ref']);
      expect(view.followed_by_name).toBe('Exec board');
    });

    it('reads who follows live: in the group now, never an alum or an outsider', async () => {
      const task = { assignee_id: 'user-1', followed_by: FOLLOWER };
      expect(await service.mayRead(task, 'ch-1', 'exec-2', false)).toBe(true);
      expect(await service.mayRead(task, 'ch-1', 'user-1', false)).toBe(true);
      expect(await service.mayRead(task, 'ch-1', 'alum-1', false)).toBe(false);
      expect(await service.mayRead(task, 'ch-1', 'nobody', false)).toBe(false);
      expect(
        await service.mayRead(
          { ...task, followed_by: null },
          'ch-1',
          'exec-2',
          false,
        ),
      ).toBe(false);

      // exec-2 leaves the Exec board: the next read refuses them; a member
      // given its role since can read it.
      holds['exec-2'] = ['role-1'];
      holds['user-2'] = ['role-pres'];
      try {
        expect(await service.mayRead(task, 'ch-1', 'exec-2', false)).toBe(
          false,
        );
        expect(await service.mayRead(task, 'ch-1', 'user-2', false)).toBe(true);
      } finally {
        holds['exec-2'] = ['role-pres'];
        delete holds['user-2'];
      }
    });

    it('tells the following group when it is finished: an officer to review, the rest that it is done', async () => {
      const inProgress: Task = {
        ...baseTask,
        assignee_id: 'user-1',
        created_by: 'someone-else',
        followed_by: FOLLOWER,
        status: TaskStatus.IN_PROGRESS,
      };
      mockTaskRepo.findById.mockResolvedValue(inProgress);
      mockTaskRepo.updateIfMatches.mockResolvedValue({
        ...inProgress,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      });
      mockRbac.findUserIdsWithPermissions.mockResolvedValue(['admin-1']);
      mockUserRepo.findByIds.mockResolvedValue([
        userFixture({ id: 'user-1', display_name: 'Sam' }),
      ] as User[]);

      await service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        TaskStatus.COMPLETED,
      );

      const pushes = mockNotificationService.notifyUser.mock.calls;
      const to = (userId: string) => pushes.find(([id]) => id === userId)?.[2];
      expect(to('admin-1')).toMatchObject({
        title: 'Sam submitted: Test Task',
        data: { target: { view: 'review' } },
      });
      expect(to('exec-2')).toMatchObject({
        title: 'Sam finished: Test Task',
        body: 'From Exec board · An officer confirms it',
        data: { target: { screen: 'tasks', taskId: 'task-1' } },
      });
      // The assignee hears nothing about their own task.
      expect(pushes.filter(([id]) => id === 'user-1')).toHaveLength(0);
    });

    it("changes a group task's follower on every copy, and clears it", async () => {
      const copy: Task = {
        ...baseTask,
        group_id: 'g1',
        followed_by: null,
      };
      mockTaskRepo.findById.mockResolvedValue(copy);
      await service.updateGroup('task-1', 'ch-1', 'admin-1', {
        followed_by: FOLLOWER,
      });
      expect(mockTaskRepo.setGroupFollower).toHaveBeenCalledWith(
        'ch-1',
        'g1',
        FOLLOWER,
      );
      expect(mockTaskRepo.updateUnconfirmed).not.toHaveBeenCalled();

      mockTaskRepo.findById.mockResolvedValue({
        ...copy,
        followed_by: FOLLOWER,
      });
      await service.updateGroup('task-1', 'ch-1', 'user-1', {
        followed_by: null,
      });
      expect(mockTaskRepo.setGroupFollower).toHaveBeenLastCalledWith(
        'ch-1',
        'g1',
        null,
      );
    });

    it("lets any officer keep a task's follower, but only set one they are in", async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        followed_by: FOLLOWER,
      });
      mockTaskRepo.updateUnconfirmed.mockResolvedValue({
        ...baseTask,
        title: 'New title',
        followed_by: FOLLOWER,
      });
      await service.update('task-1', 'ch-1', 'user-1', {
        title: 'New title',
        followed_by: FOLLOWER,
      });
      expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        { title: 'New title' },
      );

      mockTaskRepo.findById.mockResolvedValue(baseTask);
      await expect(
        service.update('task-1', 'ch-1', 'user-1', { followed_by: FOLLOWER }),
      ).rejects.toThrow("you're in");
    });

    it('lets a group follow a task: its members read it live and hear when it is done', async () => {
      const GROUP = 'bbbbbbbb-0000-4000-8000-0000000000c1';
      const entry = `group:${GROUP}`;
      const inGroup = new Set(['user-2']);
      mockRbac.getChannelAccessHolder.mockImplementation((_c, m, withGroups) =>
        Promise.resolve(
          accessHolderFromRoles(
            [],
            withGroups && m && inGroup.has(m.user_id) ? [GROUP] : [],
          ),
        ),
      );
      holds['user-2'] = ['role-1'];
      mockMemberRepo.findByChapter.mockResolvedValue(
        Object.entries(holds).map(([id, roles]) => member(id, roles)),
      );
      mockGroupRepo.findById.mockResolvedValue({
        id: GROUP,
        name: 'Social committee',
        kind: 'manual',
      } as never);
      mockGroupRepo.findMemberIds.mockImplementation(() =>
        Promise.resolve([...inGroup]),
      );
      try {
        const task = { assignee_id: 'user-1', followed_by: entry };
        expect(await service.mayRead(task, 'ch-1', 'user-2', false)).toBe(true);
        expect(
          await service.followerRecipients(
            { ...task, id: 't', created_by: 'admin-1' },
            'ch-1',
          ),
        ).toEqual(['user-2']);
        // Taken out of the group: no read, no push.
        inGroup.delete('user-2');
        expect(await service.mayRead(task, 'ch-1', 'user-2', false)).toBe(
          false,
        );
        expect(
          await service.followerRecipients(
            { ...task, id: 't', created_by: 'admin-1' },
            'ch-1',
          ),
        ).toEqual([]);
        // A class year opens nothing, so it follows nothing.
        inGroup.add('user-2');
        mockGroupRepo.findById.mockResolvedValue({
          id: GROUP,
          name: 'Class of 2027',
          kind: 'class_year',
        } as never);
        expect(
          await service.followerRecipients(
            { ...task, id: 't', created_by: 'admin-1' },
            'ch-1',
          ),
        ).toEqual([]);
      } finally {
        delete holds['user-2'];
      }
    });

    it("pushes the tier's role holders only, as it reads, and refuses the Everyone tier", async () => {
      const MEMBERS = 'aaaaaaaa-0000-4000-8000-000000000009';
      mockRoleRepo.findByChapter.mockResolvedValue([
        execRole,
        {
          id: 'role-everyone',
          chapter_id: 'ch-1',
          name: 'Member',
          tier_id: MEMBERS,
          permissions: [],
          system_key: 'MEMBER',
        },
      ] as never);
      mockTierRepo.findByChapter.mockResolvedValue([
        { id: EXEC, name: 'Exec board' },
        { id: MEMBERS, name: 'Members' },
      ] as never);
      expect(
        await service.followerRecipients(
          {
            id: 't',
            assignee_id: 'user-1',
            created_by: 'someone',
            followed_by: FOLLOWER,
          },
          'ch-1',
        ),
      ).toEqual(['admin-1', 'exec-2']);
      await expect(
        service.create({
          chapter_id: 'ch-1',
          title: 'Book the venue',
          assignee_id: 'user-1',
          followed_by: `tier:${MEMBERS}`,
          created_by: 'admin-1',
          due_date: '2099-03-15',
        }),
      ).rejects.toThrow("can't be what a task is from");
    });

    it('refuses a tier nobody holds a role in, and reads a tier holding Everyone as the chapter', async () => {
      const EMPTY = 'aaaaaaaa-0000-4000-8000-000000000008';
      const ALL = 'aaaaaaaa-0000-4000-8000-000000000007';
      mockRoleRepo.findByChapter.mockResolvedValue([
        execRole,
        { id: 'role-unheld', name: 'Historian', tier_id: EMPTY },
        {
          id: 'role-everyone',
          name: 'Member',
          tier_id: ALL,
          system_key: 'MEMBER',
        },
      ] as never);
      mockTierRepo.findByChapter.mockResolvedValue([
        { id: EMPTY, name: 'Chairs' },
        { id: ALL, name: 'Members' },
      ] as never);
      const base = {
        chapter_id: 'ch-1',
        title: 'Fill out the form',
        audience: 'everyone' as const,
        created_by: 'admin-1',
        due_date: '2099-03-15',
      };
      await expect(
        service.create({ ...base, audience_tier_id: EMPTY }),
      ).rejects.toThrow('Nobody holds a role in that tier yet');
      mockTaskRepo.createGroup.mockResolvedValue([
        { ...baseTask, id: 'c1', assignee_id: 'admin-1', group_id: 'g1' },
      ]);
      await service.create({ ...base, audience_tier_id: ALL });
      expect(mockTaskRepo.createGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          // Alumni left out; everyone else, holder or not.
          assignee_ids: expect.arrayContaining(['admin-1', 'exec-2', 'user-1']),
        }),
      );
      expect(
        mockTaskRepo.createGroup.mock.calls[0]![0].assignee_ids,
      ).not.toContain('alum-1');
    });

    it('never tells the creator twice when they are in the following group', async () => {
      const inProgress: Task = {
        ...baseTask,
        assignee_id: 'user-1',
        created_by: 'admin-1',
        followed_by: FOLLOWER,
        status: TaskStatus.IN_PROGRESS,
      };
      mockTaskRepo.findById.mockResolvedValue(inProgress);
      mockTaskRepo.updateIfMatches.mockResolvedValue({
        ...inProgress,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      });
      mockRbac.findUserIdsWithPermissions.mockResolvedValue(['admin-1']);
      await service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        TaskStatus.COMPLETED,
      );
      const to = mockNotificationService.notifyUser.mock.calls.map(
        ([id]) => id,
      );
      expect(to.filter((id) => id === 'admin-1')).toHaveLength(1);
      expect(to).toContain('exec-2');
    });

    it("keeps a follower's read free of the reply and the send-back reason", () => {
      const view = service.asReadBy(
        {
          ...asView(baseTask),
          assignee_id: 'user-1',
          completion_note: 'Paid with my own card',
          sent_back_reason: 'Wrong vendor',
          proof_link: 'https://example.test/receipt',
          photos: [],
        },
        'exec-2',
        false,
      );
      expect(view).toMatchObject({
        completion_note: null,
        sent_back_reason: null,
        proof_link: null,
      });
    });

    it("refuses one copy's own follower, and changes nothing when a group edit is refused", async () => {
      const copy: Task = { ...baseTask, group_id: 'g1', followed_by: null };
      mockTaskRepo.findById.mockResolvedValue(copy);
      await expect(
        service.update('task-1', 'ch-1', 'admin-1', { followed_by: FOLLOWER }),
      ).rejects.toThrow('scope "group"');

      // Every copy confirmed: the title can't change, so neither does who
      // it is from.
      mockTaskRepo.findGroupCopies.mockResolvedValue([
        { ...copy, points_awarded: true },
      ]);
      await expect(
        service.updateGroup('task-1', 'ch-1', 'admin-1', {
          followed_by: FOLLOWER,
          title: 'New title',
        }),
      ).rejects.toThrow('Every copy is already confirmed');
      expect(mockTaskRepo.setGroupFollower).not.toHaveBeenCalled();
    });
  });

  describe('tasks for everyone (#4295 step 3)', () => {
    const member = (userId: string, roleIds: string[] = ['role-1']) =>
      memberFixture({ ...baseMember, user_id: userId, role_ids: roleIds });
    const copyOf = (assigneeId: string, over: Partial<Task> = {}): Task => ({
      ...baseTask,
      id: `copy-${assigneeId}`,
      assignee_id: assigneeId,
      group_id: 'group-1',
      ...over,
    });
    const createForEveryone = (extra: Partial<CreateTaskInput> = {}) =>
      service.create({
        chapter_id: 'ch-1',
        title: 'Fill out the form',
        audience: 'everyone',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        subtasks: ['Open it'],
        point_reward: 5,
        ...extra,
      });

    beforeEach(() => {
      mockMemberRepo.findByChapter.mockResolvedValue([
        member('admin-1'),
        member('user-1'),
        member('user-2'),
        member('alum-1', ['role-alumni']),
      ]);
      mockRbac.getAlumniRoleId.mockResolvedValue('role-alumni');
      mockTaskRepo.createGroup.mockResolvedValue([
        copyOf('user-1'),
        copyOf('admin-1'),
        copyOf('user-2'),
      ]);
    });

    it('gives each active member a copy, alumni left out, in one write', async () => {
      const result = await createForEveryone();

      expect(mockTaskRepo.createGroup).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        created_by: 'admin-1',
        audience: 'everyone',
        target_id: null,
        target_name: null,
        assignee_ids: ['admin-1', 'user-1', 'user-2'],
        title: 'Fill out the form',
        description: null,
        due_date: '2099-03-15',
        due_at: null,
        point_reward: 5,
        proof_kind: 'none',
        subtask_titles: ['Open it'],
        followed_by: null,
      });
      expect(mockTaskRepo.create).not.toHaveBeenCalled();
      expect(mockTaskRepo.createSubtasks).not.toHaveBeenCalled();
      // The officer's own copy comes back, with the group's count.
      expect(result.id).toBe('copy-admin-1');
      expect(result.group).toEqual({
        id: 'group-1',
        audience: 'everyone',
        target_id: null,
        target_name: null,
        total: 3,
        done: 0,
        confirmed: 0,
      });
    });

    it('links every copy to the minutes it was suggested from (#5562)', async () => {
      await createForEveryone({ meeting_id: 'meeting-1' });
      expect(mockTaskRepo.createGroup).toHaveBeenCalledWith(
        expect.objectContaining({ meeting_id: 'meeting-1' }),
      );
    });

    it('pushes every member but the officer who made it', async () => {
      await createForEveryone();

      const pushed = mockNotificationService.notifyUser.mock.calls.map(
        (call) => call[0],
      );
      expect(pushed.sort()).toEqual(['user-1', 'user-2']);
    });

    it.each([
      [
        'repeats',
        { recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=UTC' },
      ],
      [
        'carries photos',
        { reference_photo_paths: ['chapters/ch-1/tasks/p/a.jpg'] },
      ],
      ['posts to chat', { channel_id: 'c-1', client_message_id: 'm-1' }],
      ['also names an assignee', { assignee_id: 'user-1' }],
    ])('refuses one that %s, writing nothing', async (_label, extra) => {
      await expect(createForEveryone(extra)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockTaskRepo.createGroup).not.toHaveBeenCalled();
    });

    it('refuses a chapter with nobody active', async () => {
      mockMemberRepo.findByChapter.mockResolvedValue([
        member('alum-1', ['role-alumni']),
      ]);

      await expect(createForEveryone()).rejects.toThrow(
        'This chapter has no active members yet',
      );
      expect(mockTaskRepo.createGroup).not.toHaveBeenCalled();
    });

    it('refuses a task with neither an assignee nor an audience', async () => {
      await expect(createForEveryone({ audience: null })).rejects.toThrow(
        'A task needs an assignee',
      );
    });

    it('reads a copy with how far its group is', async () => {
      mockTaskRepo.findById.mockResolvedValue(copyOf('user-1'));
      mockTaskRepo.findGroups.mockResolvedValue([
        {
          id: 'group-1',
          chapter_id: 'ch-1',
          created_by: 'admin-1',
          audience: 'everyone',
          target_id: null,
          target_name: null,
          created_at: '2026-11-17T00:00:00.000Z',
        },
      ]);
      mockTaskRepo.findGroupCopies.mockResolvedValue([
        copyOf('user-1'),
        copyOf('user-2', { status: TaskStatus.COMPLETED }),
        copyOf('admin-1', {
          status: TaskStatus.COMPLETED,
          points_awarded: true,
        }),
      ]);

      const view = await service.findById('copy-user-1', 'ch-1');

      expect(view.group).toEqual({
        id: 'group-1',
        audience: 'everyone',
        target_id: null,
        target_name: null,
        total: 3,
        done: 2,
        confirmed: 1,
      });
      // Counted from the copies' states, not their whole rows (#5492).
      expect(mockTaskRepo.findGroupCopyStates).toHaveBeenCalledWith('ch-1', [
        'group-1',
      ]);
    });

    describe('for a role, a group or several people (2026-11-18)', () => {
      const ROLE = {
        id: 'role-rush',
        chapter_id: 'ch-1',
        name: 'Recruitment Committee',
        system_key: null,
      };
      beforeEach(() => {
        mockMemberRepo.findByChapter.mockResolvedValue([
          member('admin-1', ['role-1']),
          member('user-1', ['role-1', 'role-rush']),
          member('user-2', ['role-rush']),
          // An alum who still holds the committee role gets no copy.
          member('alum-1', ['role-alumni', 'role-rush']),
        ]);
        mockRoleRepo.findByChapter.mockResolvedValue([
          ROLE,
          {
            id: 'role-everyone',
            chapter_id: 'ch-1',
            name: 'Everyone',
            system_key: 'MEMBER',
          },
          {
            id: 'role-alumni',
            chapter_id: 'ch-1',
            name: 'Alumni',
            system_key: 'ALUMNI',
          },
          {
            id: 'role-empty',
            chapter_id: 'ch-1',
            name: 'Treasurer',
            system_key: null,
          },
        ] as never);
        mockGroupRepo.findByChapter.mockResolvedValue([
          { id: 'grp-1', chapter_id: 'ch-1', name: 'Fall 2026' },
          { id: 'grp-empty', chapter_id: 'ch-1', name: 'Nobody' },
        ] as never);
        mockGroupRepo.findMemberIds.mockImplementation(async (_c, id) =>
          id === 'grp-1' ? ['user-2', 'alum-1', 'gone-1'] : [],
        );
      });

      it("gives each of a role's holders a copy, alumni left out, naming the role", async () => {
        const result = await createForEveryone({
          audience_role_id: 'role-rush',
        });

        expect(mockTaskRepo.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({
            audience: 'role',
            target_id: 'role-rush',
            target_name: 'Recruitment Committee',
            assignee_ids: ['user-1', 'user-2'],
          }),
        );
        expect(result.group).toMatchObject({
          audience: 'role',
          target_id: 'role-rush',
          target_name: 'Recruitment Committee',
        });
      });

      it("gives each of a group's active members a copy", async () => {
        await createForEveryone({ audience_group_id: 'grp-1' });

        expect(mockTaskRepo.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({
            audience: 'group',
            target_id: 'grp-1',
            target_name: 'Fall 2026',
            assignee_ids: ['user-2'],
          }),
        );
      });

      it('reads the Everyone role as the chapter', async () => {
        await createForEveryone({ audience_role_id: 'role-everyone' });

        expect(mockTaskRepo.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({
            audience: 'everyone',
            target_id: null,
            assignee_ids: ['admin-1', 'user-1', 'user-2'],
          }),
        );
      });

      it.each([
        [
          'a role nobody holds',
          { audience_role_id: 'role-empty' },
          'Nobody holds that role yet',
        ],
        [
          'an empty group',
          { audience_group_id: 'grp-empty' },
          'Nobody is in that group yet',
        ],
        [
          'the Alumni role',
          { audience_role_id: 'role-alumni' },
          "Alumni don't get chapter tasks",
        ],
        [
          'a role of another chapter',
          { audience_role_id: 'role-x' },
          "That role isn't in this chapter",
        ],
        [
          'a role and a group',
          { audience_role_id: 'role-rush', audience_group_id: 'grp-1' },
          'Send one of audience_role_id',
        ],
      ])('refuses %s, writing nothing', async (_label, extra, message) => {
        await expect(createForEveryone(extra)).rejects.toThrow(message);
        expect(mockTaskRepo.createGroup).not.toHaveBeenCalled();
      });

      it('refuses a role without audience', async () => {
        await expect(
          createForEveryone({
            audience: null,
            assignee_id: 'user-1',
            audience_role_id: 'role-rush',
          }),
        ).rejects.toThrow('go with audience');
      });

      const forPeople = (assigneeIds: string[]) =>
        createForEveryone({ audience: null, assignee_ids: assigneeIds });

      it('gives several people a copy each, each once', async () => {
        await forPeople(['user-1', 'user-2', 'user-1']);

        expect(mockTaskRepo.createGroup).toHaveBeenCalledWith(
          expect.objectContaining({
            audience: 'people',
            target_id: null,
            target_name: null,
            assignee_ids: ['user-1', 'user-2'],
          }),
        );
      });

      it("makes one person's task from a list of one", async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(member('user-1'));
        mockTaskRepo.create.mockResolvedValue({ ...baseTask });

        await forPeople(['user-1']);

        expect(mockTaskRepo.createGroup).not.toHaveBeenCalled();
        expect(mockTaskRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ assignee_id: 'user-1' }),
        );
      });

      it.each([
        ['an alum', ['user-1', 'alum-1']],
        ['someone outside the chapter', ['user-1', 'stranger']],
        ['only an alum', ['alum-1']],
      ])('refuses a list with %s', async (_label, ids) => {
        await expect(forPeople(ids)).rejects.toThrow(
          'Everyone you pick must be an active member of the chapter',
        );
        expect(mockTaskRepo.createGroup).not.toHaveBeenCalled();
      });

      it('refuses people beside an assignee', async () => {
        await expect(
          createForEveryone({
            audience: null,
            assignee_id: 'user-1',
            assignee_ids: ['user-2', 'admin-1'],
          }),
        ).rejects.toThrow('Send one of assignee_id, assignee_ids or audience');
      });

      it("reads a role group with the role's name now, or as it was once deleted", async () => {
        mockTaskRepo.findById.mockResolvedValue(copyOf('user-1'));
        const roleGroup = {
          id: 'group-1',
          chapter_id: 'ch-1',
          created_by: 'admin-1',
          audience: 'role' as const,
          target_id: 'role-rush',
          target_name: 'Rush Committee',
          created_at: '2026-11-17T00:00:00.000Z',
        };
        mockTaskRepo.findGroups.mockResolvedValue([roleGroup]);
        mockTaskRepo.findGroupCopies.mockResolvedValue([copyOf('user-1')]);
        mockRoleRepo.findByIds.mockResolvedValue([ROLE] as never);

        const renamed = await service.findById('copy-user-1', 'ch-1');
        expect(renamed.group).toMatchObject({
          target_id: 'role-rush',
          target_name: 'Recruitment Committee',
        });
        expect(mockRoleRepo.findByIds).toHaveBeenCalledWith(
          ['role-rush'],
          'ch-1',
        );

        mockRoleRepo.findByIds.mockResolvedValue([]);
        const deleted = await service.findById('copy-user-1', 'ch-1');
        expect(deleted.group?.target_name).toBe('Rush Committee');
      });
    });

    it('reads which posting a task was claimed from, in one lookup', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([
        { ...baseTask, id: 'task-1' },
        { ...baseTask, id: 'task-2' },
      ]);
      mockOpenTaskRepo.findClaimedFrom.mockResolvedValue(
        new Map([['task-2', 'posting-1']]),
      );

      const tasks = await service.list('ch-1', 'admin-1', true);

      expect(mockOpenTaskRepo.findClaimedFrom).toHaveBeenCalledTimes(1);
      expect(mockOpenTaskRepo.findClaimedFrom).toHaveBeenCalledWith('ch-1', [
        'task-1',
        'task-2',
      ]);
      expect(tasks.map((task) => task.open_task_id)).toEqual([
        null,
        'posting-1',
      ]);
    });

    it("marks the minutes' checkbox for a task for everyone only once every copy is done (doneMarks)", async () => {
      const group = {
        id: 'group-1',
        chapter_id: 'ch-1',
        created_by: 'admin-1',
        audience: 'everyone' as const,
        target_id: null,
        target_name: null,
        created_at: '2026-11-17T00:00:00.000Z',
      };
      mockTaskRepo.findByIds.mockResolvedValue([
        copyOf('user-1', { status: TaskStatus.COMPLETED }),
        { ...baseTask, id: 'solo', status: TaskStatus.COMPLETED },
      ]);
      mockTaskRepo.findGroups.mockResolvedValue([group]);
      mockTaskRepo.findGroupCopies.mockResolvedValue([
        copyOf('user-1', { status: TaskStatus.COMPLETED }),
        copyOf('user-2', { status: TaskStatus.COMPLETED }),
      ]);

      const marks = await service.doneMarks('ch-1', ['copy-user-1', 'solo']);

      expect(marks.get('copy-user-1')).toEqual({
        done: true,
        group: { done: 2, total: 2 },
      });
      expect(marks.get('solo')).toEqual({ done: true, group: null });

      mockTaskRepo.findGroupCopies.mockResolvedValue([
        copyOf('user-1', { status: TaskStatus.COMPLETED }),
        copyOf('user-2'),
      ]);
      const partway = await service.doneMarks('ch-1', ['copy-user-1']);
      expect(partway.get('copy-user-1')).toEqual({
        done: false,
        group: { done: 1, total: 2 },
      });
    });

    describe("editing everyone's copy", () => {
      beforeEach(() => {
        const copies = [
          copyOf('user-1'),
          copyOf('user-2'),
          copyOf('admin-1', {
            status: TaskStatus.COMPLETED,
            points_awarded: true,
          }),
        ];
        mockTaskRepo.findById.mockImplementation(
          async (id: string) => copies.find((copy) => copy.id === id) ?? null,
        );
        mockTaskRepo.findGroupCopies.mockResolvedValue(copies);
        mockTaskRepo.updateUnconfirmed.mockImplementation(
          async (id: string, _chapterId: string, patch: Partial<Task>) => ({
            ...copies.find((copy) => copy.id === id)!,
            ...patch,
          }),
        );
      });

      it('edits every copy not yet confirmed and leaves the confirmed one', async () => {
        await service.updateGroup('copy-user-1', 'ch-1', 'admin-1', {
          title: 'Fill out the new form',
          due_date: '2099-03-20',
        });

        const edited = mockTaskRepo.updateUnconfirmed.mock.calls.map(
          (call) => call[0],
        );
        expect(edited.sort()).toEqual(['copy-user-1', 'copy-user-2']);
        expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
          'copy-user-2',
          'ch-1',
          { title: 'Fill out the new form', due_date: '2099-03-20' },
        );
        // A new due re-arms each copy's reminders.
        expect(mockTaskRepo.releaseReminderClaims).toHaveBeenCalledTimes(2);
      });

      it.each([
        ['a new assignee', { assignee_id: 'user-2' }],
        ['photos', { reference_photo_paths: [] }],
      ])('refuses %s for everyone at once', async (_label, input) => {
        await expect(
          service.updateGroup('copy-user-1', 'ch-1', 'admin-1', input),
        ).rejects.toThrow(BadRequestException);
        expect(mockTaskRepo.updateUnconfirmed).not.toHaveBeenCalled();
      });

      it('keeps going when another copy is confirmed mid-edit', async () => {
        mockTaskRepo.updateUnconfirmed.mockImplementation(
          async (id: string, _chapterId: string, patch: Partial<Task>) =>
            id === 'copy-user-2' ? null : { ...copyOf('user-1'), ...patch },
        );

        const view = await service.updateGroup(
          'copy-user-1',
          'ch-1',
          'admin-1',
          { title: 'Renamed' },
        );

        expect(view.id).toBe('copy-user-1');
        expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledTimes(2);
      });

      it('refuses the edit when the copy it was asked on is confirmed mid-edit', async () => {
        mockTaskRepo.updateUnconfirmed.mockImplementation(
          async (id: string, _chapterId: string, patch: Partial<Task>) =>
            id === 'copy-user-1' ? null : { ...copyOf('user-2'), ...patch },
        );

        await expect(
          service.updateGroup('copy-user-1', 'ch-1', 'admin-1', {
            title: 'Renamed',
          }),
        ).rejects.toThrow('confirmed while you were editing');
        // The other copy still took it.
        expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
          'copy-user-2',
          'ch-1',
          { title: 'Renamed' },
        );
      });

      it('edits the other copies when one fails, then says it failed', async () => {
        const down = new Error('connection reset');
        mockTaskRepo.updateUnconfirmed.mockImplementation(
          async (id: string, _chapterId: string, patch: Partial<Task>) => {
            if (id === 'copy-user-1') throw down;
            return { ...copyOf('user-2'), ...patch };
          },
        );

        await expect(
          service.updateGroup('copy-user-1', 'ch-1', 'admin-1', {
            title: 'Renamed',
          }),
        ).rejects.toBe(down);
        expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
          'copy-user-2',
          'ch-1',
          { title: 'Renamed' },
        );
      });

      it('refuses a task that is not for a group', async () => {
        mockTaskRepo.findById.mockResolvedValue(baseTask);

        await expect(
          service.updateGroup('task-1', 'ch-1', 'admin-1', { title: 'X' }),
        ).rejects.toThrow("This task isn't for a group");
      });
    });

    it("deletes everyone's copy and the group, then their photos", async () => {
      mockTaskRepo.findById.mockResolvedValue(copyOf('user-1'));
      mockTaskRepo.findGroupCopies.mockResolvedValue([
        copyOf('user-1'),
        copyOf('user-2'),
      ]);
      mockTaskRepo.findPhotos.mockResolvedValue([
        {
          id: 'photo-1',
          task_id: 'copy-user-2',
          chapter_id: 'ch-1',
          kind: 'proof',
          storage_path: 'chapters/ch-1/tasks/p1/a.jpg',
          position: 0,
          created_by: 'user-2',
          created_at: '2026-11-17T00:00:00.000Z',
        },
      ]);

      await service.deleteGroup('copy-user-1', 'ch-1');

      expect(mockTaskRepo.findPhotos).toHaveBeenCalledWith('ch-1', [
        'copy-user-1',
        'copy-user-2',
      ]);
      expect(mockTaskRepo.deleteGroup).toHaveBeenCalledWith('ch-1', 'group-1');
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [
        'chapters/ch-1/tasks/p1/a.jpg',
      ]);
    });
  });

  describe('listAssignedItems (#5492)', () => {
    const NOW = new Date('2026-11-18T12:00:00.000Z');
    /** `n` minutes before NOW, so a higher `n` is older. */
    const ago = (n: number) =>
      new Date(NOW.getTime() - n * 60_000).toISOString();
    const single = (n: number): Task => ({
      ...baseTask,
      id: `single-${String(n).padStart(2, '0')}`,
      assignee_id: `user-${n}`,
      created_at: ago(n),
    });
    const groupRow = (id: string, minutesAgo: number) => ({
      id,
      chapter_id: 'ch-1',
      created_by: 'admin-1',
      audience: 'everyone' as const,
      target_id: null,
      target_name: null,
      created_at: ago(minutesAgo),
    });
    const copiesOf = (
      groupId: string,
      count: number,
      over: (i: number) => Partial<Task> = () => ({}),
    ): Task[] =>
      Array.from({ length: count }, (_, i) => ({
        ...baseTask,
        id: `${groupId}-copy-${String(i).padStart(2, '0')}`,
        assignee_id: `member-${i}`,
        group_id: groupId,
        created_at: ago(10),
        ...over(i),
      }));
    /** The repository's one-person read: newest first, at most `limit`. */
    const serveSingles = (rows: Task[]) =>
      mockTaskRepo.findByChapter.mockImplementation((_chapterId, query) =>
        Promise.resolve(rows.slice(0, query?.limit ?? rows.length)),
      );
    /**
     * The copies as the two reads give them: their states (the narrow read)
     * and, by id, whole rows.
     */
    const serveCopies = (copies: Task[]) => {
      mockTaskRepo.findGroupCopyStates.mockImplementation(
        (_chapterId, groupIds) =>
          Promise.resolve(
            copies
              .filter((copy) => groupIds.includes(copy.group_id!))
              .map(
                ({
                  id,
                  group_id,
                  assignee_id,
                  status,
                  points_awarded,
                  due_date,
                  due_at,
                }) => ({
                  id,
                  group_id,
                  assignee_id,
                  status,
                  points_awarded,
                  due_date,
                  due_at,
                }),
              ),
          ),
      );
      mockTaskRepo.findByIds.mockImplementation((_chapterId, ids) =>
        Promise.resolve(copies.filter((copy) => ids.includes(copy.id))),
      );
    };

    it('counts a task for everyone once: 30 copies and 26 one-person tasks are 25 items', async () => {
      // 26 one-person tasks, made 1 to 26 minutes ago, and one group of 30
      // copies made 9.5 minutes ago, between them.
      serveSingles(Array.from({ length: 26 }, (_, i) => single(i + 1)));
      mockTaskRepo.findUnfinishedGroupsByCreator.mockResolvedValue([
        groupRow('group-1', 9.5),
      ]);
      serveCopies(
        copiesOf('group-1', 30, (i) =>
          i < 4 ? { status: TaskStatus.COMPLETED, completed_at: ago(5) } : {},
        ),
      );

      const items = await service.listAssignedItems('ch-1', 'admin-1', 25, NOW);

      expect(items).toHaveLength(25);
      expect(items.map((item) => item.kind === 'group')).toEqual(
        Array.from({ length: 25 }, (_, i) => i === 9),
      );
      // Newest first; the group sits in its place, and the two oldest
      // one-person tasks fall past the 25.
      expect(
        items.map((item) =>
          item.kind === 'task' ? item.task.id : item.group.id,
        ),
      ).toEqual([
        ...Array.from({ length: 9 }, (_, i) => single(i + 1).id),
        'group-1',
        ...Array.from({ length: 15 }, (_, i) => single(i + 10).id),
      ]);
      const group = items[9];
      expect(group).toEqual(
        expect.objectContaining({
          kind: 'group',
          created_at: ago(9.5),
          group: expect.objectContaining({ total: 30, done: 4, confirmed: 0 }),
        }),
      );
      expect(group.kind === 'group' && group.copies).toHaveLength(30);
      // Both lists are narrowed and capped in SQL.
      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        createdBy: 'admin-1',
        groupless: true,
        confirmed: false,
        limit: 25,
      });
      expect(mockTaskRepo.findUnfinishedGroupsByCreator).toHaveBeenCalledWith(
        'ch-1',
        'admin-1',
        25,
      );
      // The copies are read once for every group, a few columns each; one
      // whole copy per group is read for what they share.
      expect(mockTaskRepo.findGroupCopyStates).toHaveBeenCalledTimes(1);
      expect(mockTaskRepo.findGroupCopyStates).toHaveBeenCalledWith('ch-1', [
        'group-1',
      ]);
      expect(mockTaskRepo.findGroupCopies).not.toHaveBeenCalled();
      expect(mockTaskRepo.findByIds).toHaveBeenCalledTimes(1);
      expect(mockTaskRepo.findByIds).toHaveBeenCalledWith('ch-1', [
        'group-1-copy-00',
      ]);
      // The group summary is worked out from the copies already read.
      expect(mockTaskRepo.findGroups).not.toHaveBeenCalled();
    });

    it('reads the copies only of groups that make the cut, all at once', async () => {
      serveSingles(Array.from({ length: 3 }, (_, i) => single(i + 1)));
      mockTaskRepo.findUnfinishedGroupsByCreator.mockResolvedValue([
        groupRow('group-new', 1.5),
        groupRow('group-old', 50),
      ]);
      serveCopies([...copiesOf('group-new', 3), ...copiesOf('group-old', 3)]);

      const cut = await service.listAssignedItems('ch-1', 'admin-1', 2, NOW);

      expect(
        cut.map((item) =>
          item.kind === 'task' ? item.task.id : item.group.id,
        ),
      ).toEqual(['single-01', 'group-new']);
      expect(mockTaskRepo.findGroupCopyStates).toHaveBeenCalledWith('ch-1', [
        'group-new',
      ]);

      mockTaskRepo.findGroupCopyStates.mockClear();
      mockTaskRepo.findByIds.mockClear();
      mockTaskRepo.findUnfinishedGroupsByCreator.mockResolvedValue([
        groupRow('group-old', 50),
      ]);
      await service.listAssignedItems('ch-1', 'admin-1', 2, NOW);
      expect(mockTaskRepo.findGroupCopyStates).not.toHaveBeenCalled();
      expect(mockTaskRepo.findByIds).not.toHaveBeenCalled();
    });

    it('reads what the copies share from one not yet confirmed', async () => {
      // A group edit leaves a confirmed copy as it was.
      serveSingles([]);
      mockTaskRepo.findUnfinishedGroupsByCreator.mockResolvedValue([
        groupRow('group-1', 5),
      ]);
      serveCopies(
        copiesOf('group-1', 3, (i) =>
          i === 0
            ? {
                title: 'Old title',
                status: TaskStatus.COMPLETED,
                confirmed_at: ago(4),
                points_awarded: true,
              }
            : { title: 'New title' },
        ),
      );

      const [item] = await service.listAssignedItems(
        'ch-1',
        'admin-1',
        25,
        NOW,
      );

      expect(item.kind === 'group' && item.shared).toEqual(
        expect.objectContaining({ id: 'group-1-copy-01', title: 'New title' }),
      );
    });

    it('leaves out a group whose last open copy was confirmed between the reads', async () => {
      serveSingles([single(1)]);
      mockTaskRepo.findUnfinishedGroupsByCreator.mockResolvedValue([
        groupRow('group-1', 5),
      ]);
      serveCopies(
        copiesOf('group-1', 3, () => ({
          status: TaskStatus.COMPLETED,
          completed_at: ago(6),
          confirmed_at: ago(4),
          points_awarded: true,
        })),
      );

      const items = await service.listAssignedItems('ch-1', 'admin-1', 25, NOW);

      expect(items.map((item) => item.kind)).toEqual(['task']);
    });

    it('gives each copy and one-person task its display status at `now`', async () => {
      serveSingles([{ ...single(1), due_date: '2026-11-01' }]);
      mockTaskRepo.findUnfinishedGroupsByCreator.mockResolvedValue([
        groupRow('group-1', 5),
      ]);
      serveCopies(
        copiesOf('group-1', 2, (i) => ({
          due_date: i === 0 ? '2026-11-01' : '2026-12-01',
        })),
      );

      const [task, group] = await service.listAssignedItems(
        'ch-1',
        'admin-1',
        25,
        NOW,
      );

      expect(task).toEqual({
        kind: 'task',
        task: expect.objectContaining({
          status: TaskStatus.OVERDUE,
          stored_status: TaskStatus.TODO,
          group: null,
        }),
      });
      expect(
        group.kind === 'group' &&
          group.copies.map((copy) => [copy.status, copy.stored_status]),
      ).toEqual([
        [TaskStatus.OVERDUE, TaskStatus.TODO],
        [TaskStatus.TODO, TaskStatus.TODO],
      ]);
    });
  });

  describe('removeFromGroup (#5492)', () => {
    const copyOf = (assigneeId: string, over: Partial<Task> = {}): Task => ({
      ...baseTask,
      id: `copy-${assigneeId}`,
      assignee_id: assigneeId,
      group_id: 'group-1',
      ...over,
    });
    const group = {
      id: 'group-1',
      chapter_id: 'ch-1',
      created_by: 'admin-1',
      audience: 'everyone' as const,
      target_id: null,
      target_name: null,
      created_at: '2026-11-17T00:00:00.000Z',
    };

    beforeEach(() => {
      mockTaskRepo.findById.mockResolvedValue(copyOf('user-1'));
      mockTaskRepo.findGroups.mockResolvedValue([group]);
    });

    it("deletes the picked members' copies and their photos, and returns the group as it stands", async () => {
      mockTaskRepo.findGroupCopies
        .mockResolvedValueOnce([
          copyOf('user-1'),
          copyOf('user-2'),
          copyOf('user-3', { status: TaskStatus.COMPLETED }),
        ])
        .mockResolvedValueOnce([
          copyOf('user-1'),
          copyOf('user-3', { status: TaskStatus.COMPLETED }),
        ]);
      mockTaskRepo.deleteGroupCopies.mockResolvedValue(['copy-user-2']);
      mockTaskRepo.findPhotos.mockResolvedValue([
        {
          id: 'photo-1',
          task_id: 'copy-user-2',
          chapter_id: 'ch-1',
          kind: 'proof',
          storage_path: 'chapters/ch-1/tasks/p1/a.jpg',
          position: 0,
          created_by: 'user-2',
          created_at: '2026-11-17T00:00:00.000Z',
        },
      ]);

      const result = await service.removeFromGroup('copy-user-1', 'ch-1', [
        'user-2',
        'not-in-group',
      ]);

      expect(mockTaskRepo.deleteGroupCopies).toHaveBeenCalledWith(
        'ch-1',
        'group-1',
        ['copy-user-2'],
      );
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [
        'chapters/ch-1/tasks/p1/a.jpg',
      ]);
      expect(result).toEqual({
        removed: ['user-2'],
        group: {
          id: 'group-1',
          audience: 'everyone',
          target_id: null,
          target_name: null,
          total: 2,
          done: 1,
          confirmed: 0,
        },
      });
    });

    it('leaves out of the answer, and keeps the photos of, a copy confirmed before the delete reached it', async () => {
      mockTaskRepo.findGroupCopies.mockResolvedValue([
        copyOf('user-1'),
        copyOf('user-2'),
        copyOf('user-3'),
      ]);
      // user-3's copy was confirmed between the read and the delete, whose
      // own filter left it.
      mockTaskRepo.deleteGroupCopies.mockResolvedValue(['copy-user-2']);
      const photo = (taskId: string, path: string) => ({
        id: `photo-${taskId}`,
        task_id: taskId,
        chapter_id: 'ch-1',
        kind: 'proof' as const,
        storage_path: path,
        position: 0,
        created_by: 'member',
        created_at: '2026-11-17T00:00:00.000Z',
      });
      mockTaskRepo.findPhotos.mockResolvedValue([
        photo('copy-user-2', 'chapters/ch-1/tasks/p2/a.jpg'),
        photo('copy-user-3', 'chapters/ch-1/tasks/p3/a.jpg'),
      ]);

      const result = await service.removeFromGroup('copy-user-1', 'ch-1', [
        'user-2',
        'user-3',
      ]);

      expect(result.removed).toEqual(['user-2']);
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [
        'chapters/ch-1/tasks/p2/a.jpg',
      ]);
    });

    it('refuses a confirmed copy, deleting nothing', async () => {
      mockTaskRepo.findGroupCopies.mockResolvedValue([
        copyOf('user-1'),
        copyOf('user-2', { points_awarded: true }),
      ]);

      await expect(
        service.removeFromGroup('copy-user-1', 'ch-1', ['user-2']),
      ).rejects.toThrow('A confirmed copy stays');
      expect(mockTaskRepo.deleteGroupCopies).not.toHaveBeenCalled();
    });

    it('refuses taking out everyone, which is deleting the task', async () => {
      mockTaskRepo.findGroupCopies.mockResolvedValue([
        copyOf('user-1'),
        copyOf('user-2'),
      ]);

      await expect(
        service.removeFromGroup('copy-user-1', 'ch-1', ['user-1', 'user-2']),
      ).rejects.toThrow('delete the task for everyone instead');
      expect(mockTaskRepo.deleteGroupCopies).not.toHaveBeenCalled();
    });

    it("refuses a task that isn't for a group", async () => {
      mockTaskRepo.findById.mockResolvedValue({ ...baseTask, group_id: null });

      await expect(
        service.removeFromGroup('task-1', 'ch-1', ['user-2']),
      ).rejects.toThrow("This task isn't for a group");
    });

    it('is a 404 for a task not in the chapter', async () => {
      mockTaskRepo.findById.mockResolvedValue(null);

      await expect(
        service.removeFromGroup('task-1', 'ch-1', ['user-2']),
      ).rejects.toThrow('Task not found');
    });
  });

  describe('repeating tasks (#5119)', () => {
    const RULE = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=America/New_York';
    const create = (extra: Partial<CreateTaskInput> = {}) =>
      service.create({
        chapter_id: 'ch-1',
        title: 'Kitchen duty',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2026-11-16',
        // 9 PM New York.
        due_at: '2026-11-17T02:00:00.000Z',
        subtasks: ['Wipe', 'Mop'],
        point_reward: 5,
        recurrence_rule: RULE,
        ...extra,
      });

    beforeEach(() => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.createSeries.mockResolvedValue({
        ...baseTask,
        series_id: 'series-1',
        occurrence_date: '2026-11-16',
      });
    });

    it('writes the series and its first copy, with its checklist, in one call', async () => {
      const result = await create();

      expect(mockTaskRepo.createSeries).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        created_by: 'admin-1',
        title: 'Kitchen duty',
        description: null,
        assignee_id: 'user-1',
        point_reward: 5,
        proof_kind: 'none',
        subtask_titles: ['Wipe', 'Mop'],
        due_time: '21:00:00',
        recurrence_rule: RULE,
        first_due_date: '2026-11-16',
        first_due_at: '2026-11-17T02:00:00.000Z',
        latest_due_at: '2026-11-17T02:00:00.000Z',
        next_due_date: '2026-11-23',
      });
      expect(mockTaskRepo.create).not.toHaveBeenCalled();
      expect(mockTaskRepo.createSubtasks).not.toHaveBeenCalled();
      expect(result.series_id).toBe('series-1');
    });

    it('keeps an untimed series due by the end of the day in its zone', async () => {
      await create({ due_at: undefined });

      expect(mockTaskRepo.createSeries).toHaveBeenCalledWith(
        expect.objectContaining({
          due_time: null,
          first_due_at: null,
          latest_due_at: '2026-11-17T05:00:00.000Z',
        }),
      );
    });

    it('refuses an UNTIL that leaves no copy after the first, writing nothing', async () => {
      await expect(
        create({
          recurrence_rule:
            'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20261120;TZID=America/New_York',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.createSeries).not.toHaveBeenCalled();
    });

    it('makes a plain task for a null rule', async () => {
      mockTaskRepo.create.mockResolvedValue(baseTask);

      await create({ recurrence_rule: null });

      expect(mockTaskRepo.create).toHaveBeenCalled();
      expect(mockTaskRepo.createSeries).not.toHaveBeenCalled();
    });

    it('refuses a rule it cannot read, writing nothing', async () => {
      await expect(create({ recurrence_rule: 'WEEKLY' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockTaskRepo.createSeries).not.toHaveBeenCalled();
    });

    it('says how a copy repeats on reads', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        series_id: 'series-1',
      });
      mockTaskRepo.findSeries.mockResolvedValue([
        {
          id: 'series-1',
          recurrence_rule: RULE,
          next_due_date: '2026-11-23',
          ended_at: null,
        } as never,
      ]);

      const task = await service.findById('task-1', 'ch-1');

      expect(task.series).toEqual({
        recurrence_rule: RULE,
        next_due_date: '2026-11-23',
        ended: false,
      });
      expect(mockTaskRepo.findSeries).toHaveBeenCalledWith('ch-1', [
        'series-1',
      ]);
    });

    it('reads no series for tasks that do not repeat', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      const task = await service.findById('task-1', 'ch-1');

      expect(task.series).toBeNull();
      expect(mockTaskRepo.findSeries).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('links a task suggested from minutes to them by id (#5562)', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);
      await service.create({
        chapter_id: 'ch-1',
        title: 'Book the bus',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        meeting_id: 'meeting-1',
      });
      expect(mockTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ meeting_id: 'meeting-1' }),
      );
    });

    it('should create task successfully', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);

      const result = await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        description: 'Test description',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        point_reward: 10,
      });

      expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
      );
      expect(mockTaskRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        title: 'Test Task',
        description: 'Test description',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        due_at: null,
        status: TaskStatus.TODO,
        point_reward: 10,
        points_awarded: false,
        proof_kind: 'none',
        completed_at: null,
        confirmed_at: null,
      });
      expect(result).toEqual({ ...baseTask, photos: [] });
    });

    it('adds the subtasks in order after the task (#4003)', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);

      await service.create({
        chapter_id: 'ch-1',
        title: 'Clean the kitchen',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        subtasks: [' Wipe the counters ', '', 'Mop the floor'],
      });

      expect(mockTaskRepo.createSubtasks).toHaveBeenCalledWith([
        {
          task_id: 'task-1',
          chapter_id: 'ch-1',
          title: 'Wipe the counters',
          position: 0,
        },
        {
          task_id: 'task-1',
          chapter_id: 'ch-1',
          title: 'Mop the floor',
          position: 1,
        },
      ]);
    });

    describe('with a due time (#4003)', () => {
      const create = (due_date: string, due_at: string) =>
        service.create({
          chapter_id: 'ch-1',
          title: 'Take out the trash',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date,
          due_at,
        });

      it('stores the instant beside the day', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue({
          ...baseTask,
          due_at: '2099-03-16T02:00:00.000Z',
        });
        (mockNotificationService as any).timeZoneFor = jest
          .fn()
          .mockResolvedValue('America/New_York');

        // 9 PM Central on Mar 15 is 02:00Z on Mar 16: still "on" Mar 15.
        await create('2099-03-15', '2099-03-15T21:00:00-05:00');

        expect(mockTaskRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            due_date: '2099-03-15',
            due_at: '2099-03-16T02:00:00.000Z',
          }),
        );
        // The assignee reads the time in their own zone.
        const payload = mockNotificationService.notifyUser.mock.calls[0][2];
        expect(
          payload.personalize!({
            userId: 'user-1',
            timeZone: 'America/Chicago',
          }).body,
        ).toContain('due Sun, Mar 15, 2099, 9 PM');
      });

      it('refuses an instant that is not on the due day', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        await expect(
          create('2099-03-15', '2099-03-18T12:00:00.000Z'),
        ).rejects.toThrow('due_at must fall on due_date');
        expect(mockTaskRepo.create).not.toHaveBeenCalled();
      });
    });

    it('should reject create when assignee is not a chapter member', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2099-03-15',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2099-03-15',
        }),
      ).rejects.toThrow('Assignee must be a member of the chapter');

      expect(mockTaskRepo.create).not.toHaveBeenCalled();
    });

    it('should reject invalid due_date', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);

      await expect(
        service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: 'invalid-date',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.create).not.toHaveBeenCalled();
    });

    it('posts a server-originated task card when channel + client_message_id are set', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);
      mockUserRepo.findByIds.mockResolvedValue([
        {
          id: 'admin-1',
          display_name: 'Admin Alice',
        } as User,
        {
          id: 'user-1',
          display_name: 'Member Bob',
        } as User,
      ]);

      await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        point_reward: 10,
        channel_id: 'channel-1',
        client_message_id: 'cmid-1',
      });

      expect(mockChatService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: 'ch-1',
          channel_id: 'channel-1',
          sender_id: 'admin-1',
          kind: 'task',
          system_originated: true,
          client_message_id: 'cmid-1',
          payload: expect.objectContaining({
            task_id: 'task-1',
            title: 'Test Task',
            assigner_name: 'Admin Alice',
            assignee_name: 'Member Bob',
            status: 'TODO',
            point_reward: 10,
          }),
        }),
      );
    });

    it('does not post a card for a dashboard create (no channel)', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);

      await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
      });

      expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns the created task even if the card post fails (best-effort)', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);
      mockChatService.sendMessage.mockRejectedValue(new Error('chat down'));

      const result = await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        channel_id: 'channel-1',
        client_message_id: 'cmid-1',
      });

      expect(result).toEqual({
        ...baseTask,
        photos: [],
        card_posted: false,
      });
    });

    // #1717: the client renders an optimistic `loading` placeholder keyed on
    // `client_message_id` and waits for the Realtime echo of the card to
    // reconcile it. A failed post means no echo ever arrives, so the caller
    // has to be told — otherwise the placeholder is permanent and an officer
    // cannot tell a committed create from a lost one.
    describe('card_posted (#1717)', () => {
      const chatInput = {
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        point_reward: 10,
        channel_id: 'channel-1',
        client_message_id: 'cmid-1',
      };

      it('reports card_posted: true when the card posts', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);
        mockUserRepo.findByIds.mockResolvedValue([
          {
            id: 'admin-1',
            display_name: 'Admin Alice',
          } as User,
          {
            id: 'user-1',
            display_name: 'Member Bob',
          } as User,
        ]);

        const result = await service.create(chatInput);

        expect(result).toEqual({
          ...baseTask,
          photos: [],
          card_posted: true,
        });
      });

      it('reports card_posted: false when the card post throws', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);
        mockChatService.sendMessage.mockRejectedValue(new Error('chat down'));

        const result = await service.create(chatInput);

        expect(result).toEqual({
          ...baseTask,
          photos: [],
          card_posted: false,
        });
      });

      it('omits card_posted entirely for a dashboard create', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);

        const result = await service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2099-03-15',
        });

        expect(result).toEqual({ ...baseTask, photos: [] });
        expect('card_posted' in result).toBe(false);
        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
      });

      it('omits card_posted when only one half of the chat context is given', async () => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);

        const result = await service.create({
          chapter_id: 'ch-1',
          title: 'Test Task',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2099-03-15',
          channel_id: 'channel-1',
        });

        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
        expect('card_posted' in result).toBe(false);
      });
    });
  });

  describe('updateStatus', () => {
    it('should allow TODO → IN_PROGRESS transition', async () => {
      const updated: Task = { ...baseTask, status: TaskStatus.IN_PROGRESS };
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.update.mockResolvedValue(updated);

      const result = await service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        TaskStatus.IN_PROGRESS,
      );

      expect(mockTaskRepo.update).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({ status: TaskStatus.IN_PROGRESS }),
      );
      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('should allow IN_PROGRESS → COMPLETED transition', async () => {
      const inProgress: Task = { ...baseTask, status: TaskStatus.IN_PROGRESS };
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(inProgress);
      mockTaskRepo.updateIfMatches.mockResolvedValue(completed);

      const result = await service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        TaskStatus.COMPLETED,
      );

      expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.anything(),
        expect.objectContaining({
          status: TaskStatus.COMPLETED,
          completed_at: expect.any(String),
        }),
      );
      expect(result.status).toBe(TaskStatus.COMPLETED);
    });

    describe('the assignee taking back their own completion', () => {
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };

      it('moves an unconfirmed completion back to IN_PROGRESS through the compare-and-set', async () => {
        mockTaskRepo.findById.mockResolvedValue(completed);
        mockTaskRepo.reopenCompletion.mockResolvedValue({
          ...completed,
          status: TaskStatus.IN_PROGRESS,
          completed_at: null,
        });

        const result = await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        );

        expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          {
            expectedCompletedAt: '2026-02-26T18:30:00.000Z',
            pointsAwarded: false,
          },
        );
        expect(mockTaskRepo.update).not.toHaveBeenCalled();
        expect(result.status).toBe(TaskStatus.IN_PROGRESS);
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('refuses once an officer has confirmed it', async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...completed,
          points_awarded: true,
          confirmed_at: '2026-02-26T19:00:00.000Z',
        });

        await expect(
          service.updateStatus(
            'task-1',
            'ch-1',
            'user-1',
            false,
            TaskStatus.IN_PROGRESS,
          ),
        ).rejects.toThrow('An officer already confirmed this task');
        expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
      });

      it('refuses when a confirm wins the race to the row', async () => {
        mockTaskRepo.findById.mockResolvedValue(completed);
        mockTaskRepo.reopenCompletion.mockResolvedValue(null);

        await expect(
          service.updateStatus(
            'task-1',
            'ch-1',
            'user-1',
            false,
            TaskStatus.IN_PROGRESS,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it("still sends an officer moving someone else's completion to the reject endpoint", async () => {
        mockTaskRepo.findById.mockResolvedValue(completed);

        await expect(
          service.updateStatus(
            'task-1',
            'ch-1',
            'officer-1',
            true,
            TaskStatus.IN_PROGRESS,
          ),
        ).rejects.toThrow('Use the reject completion endpoint');
        expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
      });
    });

    it('should reject invalid transition TODO → COMPLETED', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        ),
      ).rejects.toThrow('Invalid status transition from TODO to COMPLETED');

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should reject invalid transition TODO → OVERDUE', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.OVERDUE,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should reject non-assignee updating status without admin', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'other-user',
          false,
          TaskStatus.IN_PROGRESS,
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'other-user',
          false,
          TaskStatus.IN_PROGRESS,
        ),
      ).rejects.toThrow('Only the assignee or an admin can update task status');

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when task not found', async () => {
      mockTaskRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        ),
      ).rejects.toThrow('Task not found');
    });
  });

  describe('confirmCompletion', () => {
    it('should confirm completion with points via the atomic RPC', async () => {
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.confirmCompletionAtomic.mockResolvedValue(confirmed);

      const result = await service.confirmCompletion(
        'task-1',
        'ch-1',
        'admin-1',
      );

      // The confirm + ledger insert now happen in one DB transaction, so the
      // service delegates to the RPC and never issues separate writes.
      expect(mockTaskRepo.confirmCompletionAtomic).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
      );
      expect(mockTaskRepo.update).not.toHaveBeenCalled();
      expect(result.points_awarded).toBe(true);
    });

    it('should confirm a completion without points that needed proof', async () => {
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
        point_reward: null,
        proof_kind: 'photo',
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.confirmCompletionAtomic.mockResolvedValue(confirmed);

      const result = await service.confirmCompletion(
        'task-1',
        'ch-1',
        'admin-1',
      );

      expect(mockTaskRepo.confirmCompletionAtomic).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
      );
      expect(result.points_awarded).toBe(true);
    });

    it('should prevent double point award (fast-path guard)', async () => {
      const alreadyConfirmed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(alreadyConfirmed);

      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow('Points have already been awarded for this task');

      expect(mockTaskRepo.confirmCompletionAtomic).not.toHaveBeenCalled();
    });

    it('should reject when the atomic confirm awards nothing (lost race)', async () => {
      // findById sees an un-awarded task, but a concurrent confirm flips
      // points_awarded first, so the compare-and-set updates 0 rows (null).
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.confirmCompletionAtomic.mockResolvedValue(null);

      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow('no longer eligible or points were already awarded');
    });

    it('refuses a self-confirmation, mirroring adjustPoints (#1056)', async () => {
      // The assignee is `user-1`, and here `user-1` is also the caller: an
      // officer holding `tasks:manage` who assigned a task to themselves,
      // marked it COMPLETED, and is now confirming it. Confirming would insert
      // `point_reward` into their own ledger with no second party — exactly
      // what `PointsService.adjustPoints` refuses for `points:adjust`.
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(completed);

      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'user-1'),
      ).rejects.toThrow('Admins cannot confirm their own task completions');

      // The ledger must not move. Refusing after the award would be no refusal
      // at all, so this assertion is the actual point of the test.
      expect(mockTaskRepo.confirmCompletionAtomic).not.toHaveBeenCalled();
    });

    it('refuses a self-confirmation before the status guard', async () => {
      // A self-confirm on a task that is not COMPLETED must still read as
      // Forbidden, not BadRequest: which refusal a caller sees must not depend
      // on what state their own task happens to be in.
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockTaskRepo.confirmCompletionAtomic).not.toHaveBeenCalled();
    });

    it('still allows a different admin to confirm', async () => {
      // The guard keys on the assignee, not on "is an admin involved" — the
      // ordinary two-party path must stay open.
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.confirmCompletionAtomic.mockResolvedValue(confirmed);

      const result = await service.confirmCompletion(
        'task-1',
        'ch-1',
        'some-other-officer',
      );

      expect(mockTaskRepo.confirmCompletionAtomic).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
      );
      expect(result.points_awarded).toBe(true);
    });

    it('should reject confirmation when task not COMPLETED', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
      ).rejects.toThrow(
        'Task must be marked COMPLETED by assignee before confirmation',
      );

      expect(mockTaskRepo.confirmCompletionAtomic).not.toHaveBeenCalled();
    });
  });

  describe('rejectCompletion', () => {
    it('should reject completion and revert to IN_PROGRESS', async () => {
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const reverted: Task = {
        ...completed,
        status: TaskStatus.IN_PROGRESS,
        completed_at: null,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.reopenCompletion.mockResolvedValue(reverted);

      const result = await service.rejectCompletion(
        'task-1',
        'ch-1',
        'Needs more work',
      );

      // Stamped with when it was sent back, which Activity reads as the
      // moment it waits on the assignee again.
      expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        {
          sentBackAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          sentBackReason: 'Needs more work',
          expectedCompletedAt: '2026-02-26T18:30:00.000Z',
          pointsAwarded: false,
        },
      );
      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
      // The push carries the reason (#4635).
      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          title: 'An officer sent back: Test Task',
          body: '"Needs more work"',
        }),
      );
    });

    it('names the officer who sent it back', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      });
      mockTaskRepo.reopenCompletion.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.IN_PROGRESS,
      });
      mockUserRepo.findByIds.mockResolvedValue([
        userFixture({ id: 'admin-1', display_name: 'Paul Carlson' }),
      ]);

      await service.rejectCompletion('task-1', 'ch-1', 'Corner is dusty', {
        actorUserId: 'admin-1',
      });

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          title: 'Paul Carlson sent back: Test Task',
          body: '"Corner is dusty"',
        }),
      );
    });

    it.each([undefined, null, '', '   '])(
      'refuses a send-back with no reason (%p)',
      async (comment) => {
        await expect(
          service.rejectCompletion('task-1', 'ch-1', comment),
        ).rejects.toThrow('Say what needs to change to send it back');
        expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
      },
    );

    it('refuses a reason over 200 characters', async () => {
      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'x'.repeat(201)),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
    });

    it('stores the trimmed reason, and "ask for a photo" raises the proof kind', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      });
      mockTaskRepo.reopenCompletion.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.IN_PROGRESS,
        proof_kind: 'photo',
      });

      await service.rejectCompletion('task-1', 'ch-1', '  Blurry  ', {
        requirePhoto: true,
      });

      expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({
          sentBackReason: 'Blurry',
          proofKind: 'photo',
        }),
      );
    });

    it('sends back a task that needed no sign-off, though it reads confirmed', async () => {
      // No points, no proof: confirmed as it was marked done (#4635).
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        point_reward: null,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
        confirmed_at: '2026-02-26T18:30:00.000Z',
        points_awarded: true,
      });
      mockTaskRepo.reopenCompletion.mockResolvedValue({
        ...baseTask,
        point_reward: null,
        status: TaskStatus.IN_PROGRESS,
      });

      await service.rejectCompletion('task-1', 'ch-1', 'Not finished');

      expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        expect.objectContaining({ pointsAwarded: true }),
      );
    });

    it('refuses when a confirm lands between the guard and the write', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      });
      mockTaskRepo.reopenCompletion.mockResolvedValue(null);

      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
      ).rejects.toThrow(BadRequestException);
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('should reject when task already has points awarded', async () => {
      const confirmed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(confirmed);

      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
      ).rejects.toThrow(
        'Cannot reject a task that has already been confirmed and points awarded',
      );

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });

    it('should reject when task is not COMPLETED', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
      ).rejects.toThrow('Only completed tasks can be rejected');

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should list tasks by chapter when admin', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([baseTask]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1', {});
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        ...asView(baseTask),
        photos: [],
        subtasks: [],
        series: null,
        group: null,
        open_task_id: null,
        followed_by_name: null,
      });
    });

    it('should list tasks by assignee when not admin', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([baseTask]);

      const result = await service.list('ch-1', 'user-1', false);

      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        assigneeId: 'user-1',
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        ...asView(baseTask),
        photos: [],
        subtasks: [],
        series: null,
        group: null,
        open_task_id: null,
        followed_by_name: null,
      });
    });

    it('passes paging and filters through, and keeps a member to their own tasks', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([]);
      const after = { created_at: '2026-01-01T00:00:00+00:00', id: 'task-9' };

      await service.list('ch-1', 'user-1', false, {
        confirmed: true,
        after,
        limit: 50,
      });

      expect(mockTaskRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        confirmed: true,
        after,
        limit: 50,
        assigneeId: 'user-1',
      });
    });

    it('refuses a calendar-invalid cursor with a 400, not a database 500', async () => {
      await expect(
        service.list('ch-1', 'user-1', true, {
          after: { created_at: '2026-02-30T00:00:00Z', id: 'task-9' },
          limit: 50,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('counts in SQL, a member only their own', async () => {
      mockTaskRepo.countByChapter.mockResolvedValue(3);

      await expect(
        service.count('ch-1', 'user-1', false, { confirmed: false }),
      ).resolves.toBe(3);
      expect(mockTaskRepo.countByChapter).toHaveBeenCalledWith('ch-1', {
        confirmed: false,
        assigneeId: 'user-1',
      });
    });

    it('should display OVERDUE status for past-due tasks', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 1);
      const overdueTask: Task = {
        ...baseTask,
        status: TaskStatus.TODO,
        due_date: pastDue.toISOString().slice(0, 10),
      };
      mockTaskRepo.findByChapter.mockResolvedValue([overdueTask]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(result[0].status).toBe(TaskStatus.OVERDUE);
    });

    it('is overdue from the minute of a due time, not the day after (#4003)', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const passed: Task = {
        ...baseTask,
        id: 'passed',
        due_date: today,
        due_at: new Date(Date.now() - 60_000).toISOString(),
      };
      const ahead: Task = {
        ...baseTask,
        id: 'ahead',
        due_date: today,
        due_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      };
      mockTaskRepo.findByChapter.mockResolvedValue([passed, ahead]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(result.map((task) => task.status)).toEqual([
        TaskStatus.OVERDUE,
        TaskStatus.TODO,
      ]);
    });

    /**
     * The point of `stored_status` (#1051): `OVERDUE` collapses TODO and
     * IN_PROGRESS into one indistinct rendered value, and the transition table
     * is checked against the stored one. Without this field a client cannot
     * tell which transition is legal, so it cannot offer the assignee any
     * action on an overdue task at all.
     */
    it('carries the stored status alongside a derived OVERDUE', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 1);
      const dueDate = pastDue.toISOString().slice(0, 10);
      mockTaskRepo.findByChapter.mockResolvedValue([
        { ...baseTask, id: 'a', status: TaskStatus.TODO, due_date: dueDate },
        {
          ...baseTask,
          id: 'b',
          status: TaskStatus.IN_PROGRESS,
          due_date: dueDate,
        },
      ]);

      const result = await service.list('ch-1', 'user-1', true);

      // Both render identically...
      expect(result.map((t) => t.status)).toEqual([
        TaskStatus.OVERDUE,
        TaskStatus.OVERDUE,
      ]);
      // ...and are told apart only by the stored value.
      expect(result.map((t) => t.stored_status)).toEqual([
        TaskStatus.TODO,
        TaskStatus.IN_PROGRESS,
      ]);
    });

    // The guard the ternary rewrite could silently lose. Without this, dropping
    // the `TODO || IN_PROGRESS` term keeps every other test green, and a
    // COMPLETED task past its due date would render OVERDUE — grouping into the
    // wrong board column and hiding Confirm, so its points are never awarded.
    it('never derives OVERDUE for a COMPLETED task past its due date', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 1);
      mockTaskRepo.findByChapter.mockResolvedValue([
        {
          ...baseTask,
          status: TaskStatus.COMPLETED,
          due_date: pastDue.toISOString().slice(0, 10),
        },
      ]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(result[0].status).toBe(TaskStatus.COMPLETED);
      expect(result[0].stored_status).toBe(TaskStatus.COMPLETED);
    });

    it('reports stored_status unchanged when nothing is derived', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([
        { ...baseTask, status: TaskStatus.COMPLETED },
      ]);

      const result = await service.list('ch-1', 'user-1', true);

      expect(result[0].status).toBe(TaskStatus.COMPLETED);
      expect(result[0].stored_status).toBe(TaskStatus.COMPLETED);
    });
  });

  describe('findById', () => {
    it('should return task by id', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      const result = await service.findById('task-1', 'ch-1');

      expect(mockTaskRepo.findById).toHaveBeenCalledWith('task-1', 'ch-1');
      expect(result).toEqual({
        ...asView(baseTask),
        photos: [],
        subtasks: [],
        series: null,
        group: null,
        open_task_id: null,
        followed_by_name: null,
      });
    });

    it('should throw NotFoundException when task not found', async () => {
      mockTaskRepo.findById.mockResolvedValue(null);

      await expect(service.findById('task-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findById('task-1', 'ch-1')).rejects.toThrow(
        'Task not found',
      );
    });
  });

  describe('update (#4296)', () => {
    it('changes only what differs and keeps the reminders when the due date stays', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.updateUnconfirmed.mockImplementation((_id, _ch, patch) =>
        Promise.resolve({ ...baseTask, ...patch }),
      );

      const result = await service.update('task-1', 'ch-1', 'admin-1', {
        title: '  Book the venue ',
        description: 'Test description',
        due_date: '2099-03-15',
        point_reward: 25,
      });

      expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        { title: 'Book the venue', point_reward: 25 },
      );
      expect(mockTaskRepo.releaseReminderClaims).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        title: 'Book the venue',
        point_reward: 25,
        stored_status: TaskStatus.TODO,
        subtasks: [],
      });
    });

    it('re-arms the reminders when a timed task moves within its day', async () => {
      const timed = {
        ...baseTask,
        due_at: '2099-03-15T21:00:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(timed);
      mockTaskRepo.updateUnconfirmed.mockImplementation((_id, _ch, patch) =>
        Promise.resolve({ ...timed, ...patch }),
      );

      await service.update('task-1', 'ch-1', 'admin-1', {
        due_date: '2099-03-15',
        due_at: '2099-03-15T23:00:00-00:00',
      });

      expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        { due_at: '2099-03-15T23:00:00.000Z' },
      );
      expect(mockTaskRepo.releaseReminderClaims).toHaveBeenCalledWith(
        'ch-1',
        'task-1',
      );
    });

    it('takes a time off with due_at null', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        due_at: '2099-03-15T21:00:00.000Z',
      });
      mockTaskRepo.updateUnconfirmed.mockResolvedValue(baseTask);

      await service.update('task-1', 'ch-1', 'admin-1', { due_at: null });

      expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        { due_at: null },
      );
    });

    it('refuses a time that does not fall on the due date', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', {
          due_date: '2099-03-15',
          due_at: '2099-03-20T17:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.updateUnconfirmed).not.toHaveBeenCalled();
    });

    it('starts a reassigned task over and tells the new assignee', async () => {
      const waiting = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2099-03-14T12:00:00.000Z',
        sent_back_at: '2099-03-13T12:00:00.000Z',
      };
      mockTaskRepo.findById.mockResolvedValue(waiting);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.updateUnconfirmed.mockImplementation((_id, _ch, patch) =>
        Promise.resolve({ ...waiting, ...patch }),
      );

      const result = await service.update('task-1', 'ch-1', 'admin-1', {
        assignee_id: 'user-2',
      });

      expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
        'task-1',
        'ch-1',
        {
          assignee_id: 'user-2',
          status: TaskStatus.TODO,
          completed_at: null,
          sent_back_at: null,
          sent_back_reason: null,
          proof_link: null,
          completion_note: null,
        },
      );
      expect(mockTaskRepo.releaseReminderClaims).toHaveBeenCalled();
      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'ch-1',
        expect.objectContaining({ title: 'Test Task' }),
      );
      expect(result.status).toBe(TaskStatus.TODO);
    });

    it('sends no push when the officer reassigns the task to themselves (#1340)', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.updateUnconfirmed.mockImplementation((_id, _ch, patch) =>
        Promise.resolve({ ...baseTask, ...patch }),
      );

      await service.update('task-1', 'ch-1', 'admin-1', {
        assignee_id: 'admin-1',
      });

      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('refuses an assignee outside the chapter', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', {
          assignee_id: 'stranger',
        }),
      ).rejects.toThrow('Assignee must be a member of the chapter');
    });

    it('refuses a blank title', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', { title: '   ' }),
      ).rejects.toThrow('A task needs a title');
    });

    it('refuses a confirmed task', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        status: TaskStatus.COMPLETED,
        points_awarded: true,
      });

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', { title: 'New' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTaskRepo.updateUnconfirmed).not.toHaveBeenCalled();
    });

    it('refuses when a confirm lands between the read and the write', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.updateUnconfirmed.mockResolvedValue(null);

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', { title: 'New' }),
      ).rejects.toThrow('confirmed while you were editing');
    });

    it('404s a missing task', async () => {
      mockTaskRepo.findById.mockResolvedValue(null);

      await expect(
        service.update('task-1', 'ch-1', 'admin-1', { title: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('keeps the edit when releasing the reminders fails', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.updateUnconfirmed.mockImplementation((_id, _ch, patch) =>
        Promise.resolve({ ...baseTask, ...patch }),
      );
      mockTaskRepo.releaseReminderClaims.mockRejectedValue(new Error('down'));
      const report = jest
        .spyOn(caughtFailure, 'reportCaughtFailure')
        .mockImplementation(() => undefined);

      const result = await service.update('task-1', 'ch-1', 'admin-1', {
        due_date: '2099-03-20',
      });

      expect(result.due_date).toBe('2099-03-20');
      expect(report).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ site: 'task-edit-release-reminders' }),
      );
      report.mockRestore();
    });
  });

  describe('delete', () => {
    it('should delete task', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.delete.mockResolvedValue();

      await service.delete('task-1', 'ch-1');

      expect(mockTaskRepo.findById).toHaveBeenCalledWith('task-1', 'ch-1');
      expect(mockTaskRepo.delete).toHaveBeenCalledWith('task-1', 'ch-1');
    });

    it('should throw NotFoundException when task not found', async () => {
      mockTaskRepo.findById.mockResolvedValue(null);

      await expect(service.delete('task-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockTaskRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('notifications', () => {
    it('should notify assignee when task is created', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue(baseTask);
      mockUserRepo.findByIds.mockResolvedValue([
        userFixture({ id: 'admin-1', display_name: 'Paul Carlson' }),
      ]);

      await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'user-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
        point_reward: 10,
      });

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          title: 'Test Task',
          body: 'From Paul Carlson · due Sun, Mar 15, 2099 · 10 points',
          priority: 'NORMAL',
          category: 'tasks',
        }),
      );
    });

    it('does not push a task someone assigns to themselves', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
      mockTaskRepo.create.mockResolvedValue({
        ...baseTask,
        assignee_id: 'admin-1',
      });

      await service.create({
        chapter_id: 'ch-1',
        title: 'Test Task',
        assignee_id: 'admin-1',
        created_by: 'admin-1',
        due_date: '2099-03-15',
      });

      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('should notify assignee when task completion is confirmed', async () => {
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };
      const confirmed: Task = {
        ...completed,
        confirmed_at: '2026-02-26T19:00:00.000Z',
        points_awarded: true,
      };
      mockTaskRepo.findById.mockResolvedValue(completed);
      mockTaskRepo.confirmCompletionAtomic.mockResolvedValue(confirmed);

      mockUserRepo.findByIds.mockResolvedValue([
        userFixture({ id: 'admin-1', display_name: 'Paul Carlson' }),
      ]);

      await service.confirmCompletion('task-1', 'ch-1', 'admin-1');

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          title: 'Paul Carlson confirmed: Test Task',
          body: '+10 points',
          priority: 'NORMAL',
          category: 'tasks',
        }),
      );
    });

    // #358: the creator is notified so a completed task doesn't strand
    // waiting for a manual board check — mirrors the OVERDUE sweep's
    // "notify the creator, not every tasks:manage holder" rule.
    describe('task completion (#358)', () => {
      const creatorMember: Member = {
        ...baseMember,
        id: 'member-admin',
        user_id: 'admin-1',
      };
      const completed: Task = {
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
      };

      it("notifies the task's creator when the assignee marks it completed", async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.updateIfMatches.mockResolvedValue(completed);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(creatorMember);

        await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1', // the assignee
          false,
          TaskStatus.COMPLETED,
        );

        expect(mockMemberRepo.findByUserAndChapter).toHaveBeenCalledWith(
          'admin-1', // task.created_by
          'ch-1',
        );
        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'admin-1',
          'ch-1',
          expect.objectContaining({
            title: 'A member submitted: Test Task',
            body: 'Confirm to award 10 points',
            priority: 'NORMAL',
            category: 'tasks',
            threadId: 'tasks:review',
            data: {
              target: { screen: 'tasks', taskId: 'task-1', view: 'review' },
            },
          }),
        );
      });

      it("notifies the creator when an admin marks a task completed on the assignee's behalf", async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.updateIfMatches.mockResolvedValue(completed);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(creatorMember);

        await service.updateStatus(
          'task-1',
          'ch-1',
          'other-admin', // a different tasks:manage holder, not the creator
          true,
          TaskStatus.COMPLETED,
        );

        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'admin-1',
          'ch-1',
          expect.objectContaining({ title: 'A member submitted: Test Task' }),
        );
      });

      it('does not notify when the creator is the one who completed their own task', async () => {
        const selfAssigned: Task = {
          ...baseTask,
          assignee_id: 'admin-1',
          created_by: 'admin-1',
          status: TaskStatus.IN_PROGRESS,
        };
        mockTaskRepo.findById.mockResolvedValue(selfAssigned);
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...selfAssigned,
          status: TaskStatus.COMPLETED,
        });

        await service.updateStatus(
          'task-1',
          'ch-1',
          'admin-1',
          false,
          TaskStatus.COMPLETED,
        );

        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('does not notify a creator who has since left the chapter', async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.updateIfMatches.mockResolvedValue(completed);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

        await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        );

        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('does not notify for a transition other than COMPLETED', async () => {
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.update.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });

        await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        );

        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('returns the completed task even when the notification provider fails (best-effort)', async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.updateIfMatches.mockResolvedValue(completed);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(creatorMember);
        mockNotificationService.notifyUser.mockRejectedValueOnce(
          new Error('push provider down'),
        );
        const reported = jest.spyOn(caughtFailure, 'reportCaughtFailure');

        const result = await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        );

        expect(result.status).toBe(TaskStatus.COMPLETED);
        // Reported, not only logged (#4096).
        expect(reported).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ level: 'warning', site: 'task-notify' }),
        );
        reported.mockRestore();
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.anything(),
          expect.objectContaining({ status: TaskStatus.COMPLETED }),
        );
      });

      it('returns the completed task even when the creator-membership lookup itself throws', async () => {
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
        });
        mockTaskRepo.updateIfMatches.mockResolvedValue(completed);
        mockMemberRepo.findByUserAndChapter.mockRejectedValueOnce(
          new Error('connection pool exhausted'),
        );

        const result = await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.COMPLETED,
        );

        expect(result.status).toBe(TaskStatus.COMPLETED);
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });
    });
  });

  describe('subtasks (#4003)', () => {
    const subtask = {
      id: 'sub-1',
      task_id: 'task-1',
      chapter_id: 'ch-1',
      title: 'Mop the floor',
      position: 0,
      done_at: null,
      created_at: '2026-02-26T00:00:00.000Z',
    };

    it('lists each task with its own subtasks', async () => {
      mockTaskRepo.findByChapter.mockResolvedValue([
        baseTask,
        { ...baseTask, id: 'task-2' },
      ]);
      mockTaskRepo.findSubtasks.mockResolvedValue([subtask]);

      const result = await service.list('ch-1', 'admin-1', true);

      expect(mockTaskRepo.findSubtasks).toHaveBeenCalledWith('ch-1', [
        'task-1',
        'task-2',
      ]);
      expect(result.map((task) => task.subtasks)).toEqual([[subtask], []]);
    });

    it('lets the assignee check one off', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.setSubtaskDone.mockResolvedValue({
        ...subtask,
        done_at: 'now',
      });

      await service.setSubtaskDone(
        'task-1',
        'sub-1',
        'ch-1',
        'user-1',
        false,
        true,
      );

      expect(mockTaskRepo.setSubtaskDone).toHaveBeenCalledWith(
        'ch-1',
        'task-1',
        'sub-1',
        expect.any(String),
      );
    });

    it('refuses anyone else without tasks:manage', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      await expect(
        service.setSubtaskDone(
          'task-1',
          'sub-1',
          'ch-1',
          'user-9',
          false,
          true,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockTaskRepo.setSubtaskDone).not.toHaveBeenCalled();
    });

    it('keeps a confirmed task closed', async () => {
      mockTaskRepo.findById.mockResolvedValue({
        ...baseTask,
        points_awarded: true,
      });
      await expect(
        service.setSubtaskDone(
          'task-1',
          'sub-1',
          'ch-1',
          'user-1',
          false,
          false,
        ),
      ).rejects.toThrow('This task is already confirmed');
    });

    it('adds one at the end, up to the limit', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.findSubtasks.mockResolvedValue([
        subtask,
        { ...subtask, id: 'sub-2', position: 3 },
      ]);
      mockTaskRepo.createSubtasks.mockResolvedValue([subtask]);

      await service.addSubtask('task-1', 'ch-1', 'Take out the trash');

      expect(mockTaskRepo.createSubtasks).toHaveBeenCalledWith([
        expect.objectContaining({ title: 'Take out the trash', position: 4 }),
      ]);

      mockTaskRepo.findSubtasks.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({ ...subtask, id: `s${i}` })),
      );
      await expect(
        service.addSubtask('task-1', 'ch-1', 'One more'),
      ).rejects.toThrow('up to 20 subtasks');
    });
  });
  describe('photos and proof kinds (#4565, #4635)', () => {
    const REF = 'chapters/ch-1/tasks/p1/mess.jpg';
    const PROOF = 'chapters/ch-1/tasks/p2/done.jpg';
    const uploaded = (...paths: string[]) =>
      mockStorage.listFiles.mockResolvedValue(paths);
    const photo = (
      id: string,
      kind: TaskPhotoKind,
      storage_path: string,
      position = 0,
    ): TaskPhoto => ({
      id,
      task_id: 'task-1',
      chapter_id: 'ch-1',
      kind,
      storage_path,
      position,
      created_by: 'user-1',
      created_at: '2026-02-26T00:00:00.000Z',
    });
    const inProgress = (overrides: Partial<Task> = {}): Task => ({
      ...baseTask,
      status: TaskStatus.IN_PROGRESS,
      ...overrides,
    });
    const markDone = (
      completion?: Parameters<TaskService['updateStatus']>[5],
    ) =>
      service.updateStatus(
        'task-1',
        'ch-1',
        'user-1',
        false,
        TaskStatus.COMPLETED,
        completion,
      );
    const refusalOf = async (promise: Promise<unknown>) => {
      const error = await promise.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse();
    };

    it('mints an upload URL under the chapter tasks prefix, photos only', async () => {
      const ticket = await service.requestPhotoUploadUrl({
        chapterId: 'CH-1',
        filename: 'mess.jpg',
        contentType: 'image/jpeg',
      });
      expect(ticket.storagePath).toMatch(
        /^chapters\/ch-1\/tasks\/[0-9a-f-]+\/mess\.jpg$/,
      );
      expect(mockStorage.getSignedUploadUrl).toHaveBeenCalledWith(
        'tasks',
        ticket.storagePath,
        'image/jpeg',
      );
      await expect(
        service.requestPhotoUploadUrl({
          chapterId: 'ch-1',
          filename: 'slip.pdf',
          contentType: 'application/pdf',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    describe('create', () => {
      const createWith = (extra: Partial<CreateTaskInput>) =>
        service.create({
          chapter_id: 'ch-1',
          title: 'Clean',
          assignee_id: 'user-1',
          created_by: 'admin-1',
          due_date: '2099-03-15',
          ...extra,
        });

      beforeEach(() => {
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.create.mockResolvedValue(baseTask);
      });

      it('inserts checked, de-duplicated reference photos after the task, with the proof kind', async () => {
        const SECOND = 'chapters/ch-1/tasks/p3/b.jpg';
        uploaded(REF, SECOND);
        const rows = [photo('ph-1', 'reference', REF)];
        mockTaskRepo.createPhotos.mockResolvedValue(rows);

        const result = await createWith({
          reference_photo_paths: [REF, ` ${REF} `, SECOND],
          proof_kind: 'photo',
        });

        expect(mockTaskRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ proof_kind: 'photo' }),
        );
        expect(mockTaskRepo.createPhotos).toHaveBeenCalledWith([
          expect.objectContaining({
            task_id: 'task-1',
            kind: 'reference',
            storage_path: REF,
            position: 0,
            created_by: 'admin-1',
          }),
          expect.objectContaining({ storage_path: SECOND, position: 1 }),
        ]);
        expect(mockTaskRepo.create.mock.invocationCallOrder[0]).toBeLessThan(
          mockTaskRepo.createPhotos.mock.invocationCallOrder[0],
        );
        expect(result.photos).toEqual(rows);
      });

      it('defaults the proof kind to none and inserts no photo rows', async () => {
        const result = await createWith({});
        expect(mockTaskRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ proof_kind: 'none' }),
        );
        expect(mockTaskRepo.createPhotos).not.toHaveBeenCalled();
        expect(result.photos).toEqual([]);
      });

      it('keeps the task when the photo insert fails', async () => {
        uploaded(REF);
        mockTaskRepo.createPhotos.mockRejectedValue(new Error('db down'));
        const result = await createWith({ reference_photo_paths: [REF] });
        expect(result.id).toBe('task-1');
        expect(result.photos).toEqual([]);
      });

      it('refuses a 7th reference photo', async () => {
        const paths = Array.from(
          { length: 7 },
          (_, i) => `chapters/ch-1/tasks/p${i}/x.jpg`,
        );
        uploaded(...paths);
        await expect(
          createWith({ reference_photo_paths: paths }),
        ).rejects.toThrow('at most 6');
        expect(mockTaskRepo.create).not.toHaveBeenCalled();
      });

      it.each([
        ['another chapter', 'chapters/ch-2/tasks/p1/mess.jpg', []],
        [
          'a climb out of the prefix',
          'chapters/ch-1/tasks/../service/x.jpg',
          [],
        ],
        ['nothing uploaded', REF, []],
      ])('refuses a reference photo from %s', async (_, path, objects) => {
        uploaded(...objects);
        await expect(
          createWith({ reference_photo_paths: [path] }),
        ).rejects.toThrow(BadRequestException);
        expect(mockTaskRepo.create).not.toHaveBeenCalled();
      });

      it('refuses a path another photo already holds', async () => {
        uploaded(REF);
        mockTaskRepo.isPhotoPathInUse.mockResolvedValue(true);
        await expect(
          createWith({ reference_photo_paths: [REF] }),
        ).rejects.toThrow('already attached');
      });
    });

    describe('Mark done', () => {
      it('refuses a Photo task without photos, by code', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        expect(await refusalOf(markDone())).toMatchObject({
          code: TASK_PROOF_REQUIRED_CODE,
        });
        expect(mockTaskRepo.createPhotos).not.toHaveBeenCalled();
        expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
      });

      it('refuses a Link task without a link, by code', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'link' }),
        );
        expect(await refusalOf(markDone({ proof_link: '  ' }))).toMatchObject({
          code: TASK_PROOF_REQUIRED_CODE,
        });
        expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
      });

      it.each(['javascript:alert(1)', 'not a link', 'ftp://example.com/x'])(
        'refuses an invalid link (%s)',
        async (link) => {
          mockTaskRepo.findById.mockResolvedValue(
            inProgress({ proof_kind: 'link' }),
          );
          await expect(markDone({ proof_link: link })).rejects.toThrow(
            'proof_link must be a web link',
          );
          expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
        },
      );

      it('stores a Link task’s trimmed link with the completion', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'link' }),
        );
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        await markDone({ proof_link: ' https://docs.example.com/x ' });
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.anything(),
          expect.objectContaining({
            status: TaskStatus.COMPLETED,
            proof_link: 'https://docs.example.com/x',
            completion_note: null,
          }),
        );
      });

      it('refuses a 7th proof photo', async () => {
        const paths = Array.from(
          { length: 7 },
          (_, i) => `chapters/ch-1/tasks/q${i}/x.jpg`,
        );
        uploaded(...paths);
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        await expect(markDone({ proof_photo_paths: paths })).rejects.toThrow(
          'at most 6',
        );
        expect(mockTaskRepo.createPhotos).not.toHaveBeenCalled();
        expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
      });

      it('inserts the proof rows before the task moves, and returns them', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        uploaded(PROOF);
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.createPhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          proof_kind: 'photo',
          status: TaskStatus.COMPLETED,
        });
        mockTaskRepo.findPhotos.mockResolvedValue([proofRow]);

        const result = await markDone({ proof_photo_paths: [PROOF] });

        expect(mockTaskRepo.createPhotos).toHaveBeenCalledWith([
          expect.objectContaining({
            kind: 'proof',
            storage_path: PROOF,
            position: 0,
            created_by: 'user-1',
          }),
        ]);
        expect(
          mockTaskRepo.createPhotos.mock.invocationCallOrder[0],
        ).toBeLessThan(
          mockTaskRepo.updateIfMatches.mock.invocationCallOrder[0],
        );
        expect(result.photos).toEqual([proofRow]);
      });

      it('deletes the proof rows again when the task update throws', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        uploaded(PROOF);
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.createPhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.deletePhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.updateIfMatches.mockRejectedValue(new Error('db down'));

        await expect(markDone({ proof_photo_paths: [PROOF] })).rejects.toThrow(
          'db down',
        );
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-2'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [PROOF]);
      });

      it.each([
        ['another chapter', 'chapters/ch-2/tasks/p2/done.jpg', true],
        ['nothing uploaded', PROOF, false],
      ])('refuses a proof photo from %s', async (_, path, uploadedIt) => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        uploaded(...(uploadedIt ? [path] : []));
        await expect(markDone({ proof_photo_paths: [path] })).rejects.toThrow(
          BadRequestException,
        );
        expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
      });

      it('refuses as proof a photo another task holds', async () => {
        mockTaskRepo.findById.mockResolvedValue(inProgress());
        uploaded(PROOF);
        mockTaskRepo.isPhotoPathInUse.mockResolvedValue(true);
        await expect(markDone({ proof_photo_paths: [PROOF] })).rejects.toThrow(
          'already attached',
        );
      });

      it('refuses a sent-back task marked done again with nothing new', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({
            sent_back_at: '2026-02-27T00:00:00.000Z',
            sent_back_reason: 'Blurry',
          }),
        );
        expect(await refusalOf(markDone())).toMatchObject({
          code: TASK_RESUBMIT_NEEDS_CHANGE_CODE,
        });
        expect(mockTaskRepo.updateIfMatches).not.toHaveBeenCalled();
      });

      it('takes a sent-back task back with a reply', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ sent_back_at: '2026-02-27T00:00:00.000Z' }),
        );
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        await markDone({ completion_note: '  Fixed the corner  ' });
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.anything(),
          expect.objectContaining({ completion_note: 'Fixed the corner' }),
        );
      });

      it("names the assignee, the proof and a resubmission's reply in the review push", async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({
            proof_kind: 'photo',
            sent_back_at: '2026-02-27T00:00:00.000Z',
          }),
        );
        uploaded(PROOF);
        mockTaskRepo.createPhotos.mockResolvedValue([
          photo('ph-2', 'proof', PROOF),
        ]);
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          proof_kind: 'photo',
          status: TaskStatus.COMPLETED,
          completion_note: 'Fixed the corner',
        });
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockUserRepo.findByIds.mockResolvedValue([
          userFixture({ id: 'user-1', display_name: 'Shawn Klein' }),
        ]);

        await markDone({
          completion_note: 'Fixed the corner',
          proof_photo_paths: [PROOF],
        });

        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'admin-1',
          'ch-1',
          expect.objectContaining({
            title: 'Shawn Klein resubmitted: Test Task',
            body: 'Replied "Fixed the corner" · 1 photo · Confirm to award 10 points',
            threadId: 'tasks:review',
          }),
        );
      });

      it('marks a points task with no proof done, waiting on sign-off', async () => {
        mockTaskRepo.findById.mockResolvedValue(inProgress());
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        await markDone();
        const patch = mockTaskRepo.updateIfMatches.mock.calls[0][3];
        expect(patch).not.toHaveProperty('confirmed_at');
        expect(patch).not.toHaveProperty('points_awarded');
        expect(mockTaskRepo.createPhotos).toHaveBeenCalledWith([]);
        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'admin-1',
          'ch-1',
          expect.objectContaining({
            body: 'Confirm to award 10 points',
          }),
        );
      });

      it('signs off at once a task with no points and no proof, and the push asks nothing', async () => {
        const free = inProgress({ point_reward: null });
        mockTaskRepo.findById.mockResolvedValue(free);
        mockTaskRepo.updateIfMatches.mockImplementation(
          (_id, _ch, _match, patch) => Promise.resolve({ ...free, ...patch }),
        );
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);

        const result = await markDone();

        const patch = mockTaskRepo.updateIfMatches.mock.calls[0][3];
        expect(patch.points_awarded).toBe(true);
        expect(patch.confirmed_at).toBe(patch.completed_at);
        expect(result.points_awarded).toBe(true);
        const push = mockNotificationService.notifyUser.mock.calls[0][2];
        expect(push.title).toBe('A member finished: Test Task');
        expect(push.body).toBe("Done · send it back if something's off");
      });

      it('compare-and-sets on the status, points and proof kind it judged', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ point_reward: null, proof_kind: 'link' }),
        );
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        await markDone({ proof_link: 'https://example.com/x' });
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          {
            status: TaskStatus.IN_PROGRESS,
            point_reward: null,
            proof_kind: 'link',
          },
          expect.objectContaining({ status: TaskStatus.COMPLETED }),
        );
        expect(mockTaskRepo.update).not.toHaveBeenCalled();
      });

      it('a lost compare-and-set refuses with 400 and drops the proof rows it inserted', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({ proof_kind: 'photo' }),
        );
        uploaded(PROOF);
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.createPhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.deletePhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.updateIfMatches.mockResolvedValue(null);

        await expect(markDone({ proof_photo_paths: [PROOF] })).rejects.toThrow(
          'This task changed while you were marking it done',
        );
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-2'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [PROOF]);
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('takes a sent-back Link task back with only a new link', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({
            proof_kind: 'link',
            sent_back_at: '2026-02-27T00:00:00.000Z',
            sent_back_reason: 'Wrong doc',
          }),
        );
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        await markDone({ proof_link: 'https://docs.example.com/right' });
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.anything(),
          expect.objectContaining({
            proof_link: 'https://docs.example.com/right',
            completion_note: null,
          }),
        );
      });

      it('takes a sent-back Photo task back with only new photos', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          inProgress({
            proof_kind: 'photo',
            sent_back_at: '2026-02-27T00:00:00.000Z',
            sent_back_reason: 'Blurry',
          }),
        );
        uploaded(PROOF);
        mockTaskRepo.createPhotos.mockResolvedValue([
          photo('ph-2', 'proof', PROOF),
        ]);
        mockTaskRepo.updateIfMatches.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.COMPLETED,
        });
        await markDone({ proof_photo_paths: [PROOF] });
        expect(mockTaskRepo.updateIfMatches).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.anything(),
          expect.objectContaining({
            status: TaskStatus.COMPLETED,
            proof_link: null,
            completion_note: null,
          }),
        );
      });
    });

    describe('reopening a completion', () => {
      const done = (overrides: Partial<Task> = {}): Task => ({
        ...baseTask,
        status: TaskStatus.COMPLETED,
        completed_at: '2026-02-26T18:30:00.000Z',
        ...overrides,
      });

      it('take-back reopens only the completion it read and deletes only its proof rows', async () => {
        mockTaskRepo.findById.mockResolvedValue(done());
        const ref = photo('ph-1', 'reference', REF);
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.findPhotos.mockResolvedValue([ref, proofRow]);
        mockTaskRepo.deletePhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.reopenCompletion.mockResolvedValue(
          inProgress({ completed_at: null }),
        );

        await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        );

        expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          {
            expectedCompletedAt: '2026-02-26T18:30:00.000Z',
            pointsAwarded: false,
          },
        );
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-2'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [PROOF]);
      });

      it('take-back reopens a task that needed no sign-off, though it reads confirmed', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          done({
            point_reward: null,
            confirmed_at: '2026-02-26T18:30:00.000Z',
            points_awarded: true,
          }),
        );
        mockTaskRepo.reopenCompletion.mockResolvedValue(
          inProgress({ point_reward: null }),
        );

        await service.updateStatus(
          'task-1',
          'ch-1',
          'user-1',
          false,
          TaskStatus.IN_PROGRESS,
        );

        expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.objectContaining({ pointsAwarded: true }),
        );
      });

      it('take-back still refuses a task whose points were paid', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          done({ points_awarded: true, confirmed_at: '2026-02-27T00:00:00Z' }),
        );
        await expect(
          service.updateStatus(
            'task-1',
            'ch-1',
            'user-1',
            false,
            TaskStatus.IN_PROGRESS,
          ),
        ).rejects.toThrow('stays done');
        expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
      });

      it('a send-back deletes the proof it read', async () => {
        mockTaskRepo.findById.mockResolvedValue(done());
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.findPhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.deletePhotos.mockResolvedValue([proofRow]);
        mockTaskRepo.reopenCompletion.mockResolvedValue(inProgress());

        await service.rejectCompletion('task-1', 'ch-1', 'Redo it');

        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-2'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [PROOF]);
      });

      it('a lost compare-and-set deletes nothing', async () => {
        mockTaskRepo.findById.mockResolvedValue(done());
        mockTaskRepo.findPhotos.mockResolvedValue([
          photo('ph-2', 'proof', PROOF),
        ]);
        mockTaskRepo.reopenCompletion.mockResolvedValue(null);

        await expect(
          service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
        ).rejects.toThrow(BadRequestException);
        expect(mockTaskRepo.deletePhotos).not.toHaveBeenCalled();
        expect(mockStorage.deleteFiles).not.toHaveBeenCalled();
      });

      describe('an officer-confirmed task with no points (confirmed after it was done)', () => {
        const officerConfirmed = done({
          point_reward: null,
          points_awarded: true,
          confirmed_at: '2026-02-27T09:00:00.000Z',
        });

        it('take-back refuses it', async () => {
          mockTaskRepo.findById.mockResolvedValue(officerConfirmed);
          await expect(
            service.updateStatus(
              'task-1',
              'ch-1',
              'user-1',
              false,
              TaskStatus.IN_PROGRESS,
            ),
          ).rejects.toThrow('stays done');
          expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
        });

        it('send-back refuses it', async () => {
          mockTaskRepo.findById.mockResolvedValue(officerConfirmed);
          await expect(
            service.rejectCompletion('task-1', 'ch-1', 'Redo it'),
          ).rejects.toThrow('already been confirmed');
          expect(mockTaskRepo.reopenCompletion).not.toHaveBeenCalled();
        });
      });

      it('send-back reopens a task signed off automatically (same instant, other offset)', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          done({
            point_reward: null,
            points_awarded: true,
            completed_at: '2026-02-26T18:30:00.000Z',
            confirmed_at: '2026-02-26T18:30:00+00:00',
          }),
        );
        mockTaskRepo.reopenCompletion.mockResolvedValue(inProgress());

        await service.rejectCompletion('task-1', 'ch-1', 'Redo it');

        expect(mockTaskRepo.reopenCompletion).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.objectContaining({ pointsAwarded: true }),
        );
      });

      it('confirm refuses a task that needs no sign-off', async () => {
        mockTaskRepo.findById.mockResolvedValue(
          done({
            point_reward: null,
            confirmed_at: '2026-02-26T18:30:00.000Z',
            points_awarded: true,
          }),
        );
        await expect(
          service.confirmCompletion('task-1', 'ch-1', 'admin-1'),
        ).rejects.toThrow("doesn't need an officer to confirm it");
        expect(mockTaskRepo.confirmCompletionAtomic).not.toHaveBeenCalled();
      });
    });

    describe('edit', () => {
      const NEW = 'chapters/ch-1/tasks/p3/new.jpg';

      it('adds new reference photos after the held ones and removes missing ones', async () => {
        const KEEP = 'chapters/ch-1/tasks/p4/keep.jpg';
        const keep = photo('ph-1', 'reference', KEEP, 0);
        const gone = photo('ph-3', 'reference', REF, 1);
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.findPhotos.mockResolvedValue([keep, gone]);
        mockTaskRepo.deletePhotos.mockResolvedValue([gone]);
        // Only the new path is uploaded: a held one is not re-checked.
        uploaded(NEW);
        mockTaskRepo.updateUnconfirmed.mockResolvedValue(baseTask);

        await service.update('task-1', 'ch-1', 'admin-1', {
          reference_photo_paths: [KEEP, NEW],
        });

        // A photos-only edit still goes through the compare-and-set.
        expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          { title: baseTask.title },
        );
        expect(mockTaskRepo.isPhotoPathInUse).toHaveBeenCalledTimes(1);
        expect(mockTaskRepo.isPhotoPathInUse).toHaveBeenCalledWith('ch-1', NEW);
        expect(mockTaskRepo.createPhotos).toHaveBeenCalledWith([
          expect.objectContaining({
            kind: 'reference',
            storage_path: NEW,
            position: 2,
            created_by: 'admin-1',
          }),
        ]);
        expect(
          mockTaskRepo.updateUnconfirmed.mock.invocationCallOrder[0],
        ).toBeLessThan(mockTaskRepo.createPhotos.mock.invocationCallOrder[0]);
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-3'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [REF]);
      });

      it('removes every reference photo with []', async () => {
        const held = photo('ph-1', 'reference', REF);
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.findPhotos.mockResolvedValue([held]);
        mockTaskRepo.deletePhotos.mockResolvedValue([held]);
        mockTaskRepo.updateUnconfirmed.mockResolvedValue(baseTask);

        await service.update('task-1', 'ch-1', 'admin-1', {
          reference_photo_paths: [],
        });

        expect(mockTaskRepo.createPhotos).not.toHaveBeenCalled();
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-1'],
        );
      });

      it('writes nothing when the reference set is unchanged', async () => {
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.findPhotos.mockResolvedValue([
          photo('ph-1', 'reference', REF),
        ]);
        await service.update('task-1', 'ch-1', 'admin-1', {
          reference_photo_paths: [REF],
        });
        expect(mockTaskRepo.updateUnconfirmed).not.toHaveBeenCalled();
        expect(mockTaskRepo.deletePhotos).not.toHaveBeenCalled();
      });

      it('changes the proof kind', async () => {
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.updateUnconfirmed.mockResolvedValue({
          ...baseTask,
          proof_kind: 'link',
        });
        await service.update('task-1', 'ch-1', 'admin-1', {
          proof_kind: 'link',
        });
        expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          { proof_kind: 'link' },
        );
      });

      it('reads no photos for an edit without photos or a new assignee', async () => {
        mockTaskRepo.findById.mockResolvedValue(baseTask);
        mockTaskRepo.updateUnconfirmed.mockResolvedValue({
          ...baseTask,
          title: 'New',
        });
        await service.update('task-1', 'ch-1', 'admin-1', { title: 'New' });
        expect(mockTaskRepo.findPhotos).toHaveBeenCalledTimes(1);
        // The one read is the response's own (viewWithPhotos), after the write.
        expect(
          mockTaskRepo.updateUnconfirmed.mock.invocationCallOrder[0],
        ).toBeLessThan(mockTaskRepo.findPhotos.mock.invocationCallOrder[0]);
      });

      describe('a completion waiting on sign-off', () => {
        const waiting: Task = {
          ...baseTask,
          status: TaskStatus.COMPLETED,
          completed_at: '2026-02-26T18:30:00.000Z',
        };

        it('signs it off, stamped with its completion time, when an edit zeroes its points', async () => {
          mockTaskRepo.findById.mockResolvedValue(waiting);
          mockTaskRepo.updateUnconfirmed.mockResolvedValue(waiting);
          await service.update('task-1', 'ch-1', 'admin-1', {
            point_reward: 0,
          });
          expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
            'task-1',
            'ch-1',
            {
              point_reward: null,
              confirmed_at: '2026-02-26T18:30:00.000Z',
              completed_at: '2026-02-26T18:30:00.000Z',
              points_awarded: true,
            },
          );
        });

        it('signs it off when an edit drops the last proof it needed', async () => {
          mockTaskRepo.findById.mockResolvedValue({
            ...waiting,
            point_reward: null,
            proof_kind: 'link',
          });
          mockTaskRepo.updateUnconfirmed.mockResolvedValue(waiting);
          await service.update('task-1', 'ch-1', 'admin-1', {
            proof_kind: 'none',
          });
          expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
            'task-1',
            'ch-1',
            expect.objectContaining({
              proof_kind: 'none',
              points_awarded: true,
            }),
          );
        });

        it('leaves it waiting when the edit still leaves something to check', async () => {
          mockTaskRepo.findById.mockResolvedValue({
            ...waiting,
            proof_kind: 'photo',
          });
          mockTaskRepo.updateUnconfirmed.mockResolvedValue(waiting);
          await service.update('task-1', 'ch-1', 'admin-1', {
            point_reward: 0,
          });
          const patch = mockTaskRepo.updateUnconfirmed.mock.calls[0][2];
          expect(patch).toEqual({ point_reward: null });
        });

        it('leaves it waiting when the edit touches neither points nor proof', async () => {
          mockTaskRepo.findById.mockResolvedValue({
            ...waiting,
            point_reward: null,
          });
          mockTaskRepo.updateUnconfirmed.mockResolvedValue(waiting);
          await service.update('task-1', 'ch-1', 'admin-1', { title: 'New' });
          expect(mockTaskRepo.updateUnconfirmed.mock.calls[0][2]).toEqual({
            title: 'New',
          });
        });

        it('hands it over instead of signing it off when it is also reassigned', async () => {
          mockTaskRepo.findById.mockResolvedValue(waiting);
          mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
          mockTaskRepo.updateUnconfirmed.mockResolvedValue(waiting);
          await service.update('task-1', 'ch-1', 'admin-1', {
            point_reward: 0,
            assignee_id: 'user-2',
          });
          const patch = mockTaskRepo.updateUnconfirmed.mock.calls[0][2];
          expect(patch).toMatchObject({
            status: TaskStatus.TODO,
            completed_at: null,
          });
          expect(patch).not.toHaveProperty('confirmed_at');
          expect(patch).not.toHaveProperty('points_awarded');
        });
      });

      it('a hand-over drops the proof rows and clears the reason, link and reply', async () => {
        const ref = photo('ph-1', 'reference', REF);
        const proofRow = photo('ph-2', 'proof', PROOF);
        mockTaskRepo.findById.mockResolvedValue({
          ...baseTask,
          status: TaskStatus.IN_PROGRESS,
          sent_back_at: '2026-02-27T00:00:00.000Z',
          sent_back_reason: 'Blurry',
          proof_link: 'https://example.com',
          completion_note: 'Done',
        });
        mockTaskRepo.findPhotos.mockResolvedValue([ref, proofRow]);
        mockTaskRepo.deletePhotos.mockResolvedValue([proofRow]);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(baseMember);
        mockTaskRepo.updateUnconfirmed.mockResolvedValue({
          ...baseTask,
          assignee_id: 'user-2',
        });

        await service.update('task-1', 'ch-1', 'admin-1', {
          assignee_id: 'user-2',
        });

        expect(mockTaskRepo.updateUnconfirmed).toHaveBeenCalledWith(
          'task-1',
          'ch-1',
          expect.objectContaining({
            assignee_id: 'user-2',
            status: TaskStatus.TODO,
            completed_at: null,
            sent_back_at: null,
            sent_back_reason: null,
            proof_link: null,
            completion_note: null,
          }),
        );
        expect(mockTaskRepo.deletePhotos).toHaveBeenCalledWith(
          'ch-1',
          'task-1',
          ['ph-2'],
        );
        expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [PROOF]);
      });
    });

    it('delete releases every photo the task held, and a failed delete never fails it', async () => {
      mockTaskRepo.findById.mockResolvedValue(baseTask);
      mockTaskRepo.findPhotos.mockResolvedValue([
        photo('ph-1', 'reference', REF),
        photo('ph-2', 'proof', PROOF),
      ]);
      mockStorage.deleteFiles.mockRejectedValue(new Error('storage down'));
      await expect(service.delete('task-1', 'ch-1')).resolves.toBeUndefined();
      expect(mockTaskRepo.delete).toHaveBeenCalled();
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('tasks', [
        REF,
        PROOF,
      ]);
    });

    describe('getPhotoDownloadUrl', () => {
      it('signs one of the task’s photos by id', async () => {
        mockTaskRepo.findPhotos.mockResolvedValue([
          photo('ph-1', 'reference', REF),
          photo('ph-2', 'proof', PROOF),
        ]);
        await expect(
          service.getPhotoDownloadUrl('task-1', 'ch-1', 'ph-2'),
        ).resolves.toEqual({ url: 'https://view' });
        expect(mockTaskRepo.findPhotos).toHaveBeenCalledWith('ch-1', [
          'task-1',
        ]);
        expect(mockStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
          'tasks',
          PROOF,
        );
      });

      it('404s a photo the task does not have', async () => {
        await expect(
          service.getPhotoDownloadUrl('task-1', 'ch-1', 'ph-9'),
        ).rejects.toThrow(NotFoundException);
        expect(mockStorage.getSignedDownloadUrl).not.toHaveBeenCalled();
      });

      it('signs nothing outside the chapter', async () => {
        mockTaskRepo.findPhotos.mockResolvedValue([
          photo('ph-1', 'proof', 'chapters/ch-2/tasks/p/x.jpg'),
        ]);
        await expect(
          service.getPhotoDownloadUrl('task-1', 'ch-1', 'ph-1'),
        ).rejects.toThrow(NotFoundException);
        expect(mockStorage.getSignedDownloadUrl).not.toHaveBeenCalled();
      });
    });
  });
});
