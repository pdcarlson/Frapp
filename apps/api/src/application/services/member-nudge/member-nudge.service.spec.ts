import { NotFoundException } from '@nestjs/common';
import type { MemberNudge } from '#domain/entities/member-nudge.entity';
import { TaskStatus, type Task } from '#domain/entities/task.entity';
import type { IMemberNudgeRepository } from '#domain/repositories/member-nudge.repository.interface';
import type { AiConsentService } from '../ai/ai-consent.service';
import type { AiGatewayService } from '../ai/ai-gateway.service';
import { MemberNudgeService } from './member-nudge.service';

const NOW = new Date('2026-11-13T15:00:00.000Z');
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const INPUT = {
  chapterId: 'chapter-1',
  userId: 'user-1',
  timeZone: 'America/New_York',
};

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    chapter_id: 'chapter-1',
    title: 'Book the formal venue',
    description: null,
    assignee_id: 'user-1',
    created_by: 'officer-1',
    due_date: '2026-11-16',
    due_at: null,
    status: TaskStatus.TODO,
    point_reward: null,
    points_awarded: false,
    completed_at: null,
    confirmed_at: null,
    sent_back_at: null,
    proof_kind: 'none',
    proof_link: null,
    sent_back_reason: null,
    completion_note: null,
    created_at: ago(5 * DAY),
    ...overrides,
  };
}

function card(overrides: Partial<MemberNudge> = {}): MemberNudge {
  return {
    id: 'nudge-1',
    chapter_id: 'chapter-1',
    user_id: 'user-1',
    kind: 'task_due_soon',
    task_id: 'task-1',
    title: 'A good day to start',
    body: 'A call today keeps Monday calm.',
    start_here: null,
    written_by: 'ai',
    status: 'showing',
    dismiss_reason: null,
    seen_at: null,
    created_at: ago(2 * DAY),
    expires_at: new Date(NOW.getTime() + DAY).toISOString(),
    closed_at: null,
    ...overrides,
  };
}

const GOOD = {
  title: 'A good day to start',
  body: 'The venue books up fast. A call today keeps Monday calm.',
  start_here: 'Call the first venue on your list.',
};

function setup(options: { tasks?: Task[]; showing?: MemberNudge | null } = {}) {
  const tasks = options.tasks ?? [task()];
  const nudges: jest.Mocked<IMemberNudgeRepository> = {
    findShowing: jest.fn().mockResolvedValue(options.showing ?? null),
    findRecent: jest.fn().mockResolvedValue([]),
    findRaised: jest.fn().mockResolvedValue([]),
    create: jest.fn(async (draft) =>
      card({ ...draft, created_at: NOW.toISOString() }),
    ),
    markSeen: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(true),
    deleteByUser: jest.fn().mockResolvedValue(undefined),
    closeExpired: jest.fn().mockResolvedValue(undefined),
    findSettings: jest.fn().mockResolvedValue(null),
    saveSettings: jest.fn(async (chapterId, userId, change, now) => ({
      chapter_id: chapterId,
      user_id: userId,
      enabled: change.enabled ?? true,
      quiet_until: change.quiet_until ?? null,
      updated_at: now,
    })),
  };
  const taskRepo = {
    findById: jest.fn(
      async (id: string) => tasks.find((row) => row.id === id) ?? null,
    ),
    findByChapter: jest.fn(
      async (
        _chapterId: string,
        query: { assigneeId?: string; status?: TaskStatus } = {},
      ) =>
        tasks.filter(
          (row) =>
            (query.assigneeId === undefined ||
              row.assignee_id === query.assigneeId) &&
            (query.status === undefined || row.status === query.status),
        ),
    ),
    findSubtasks: jest.fn().mockResolvedValue([]),
  };
  const users = {
    findDisplayIdentitiesByIds: jest
      .fn()
      .mockResolvedValue([
        { id: 'user-1', display_name: 'Sam Rivera', avatar_url: null },
      ]),
  };
  const chapters = {
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'chapter-1', enabled_modules: { tasks: true } }),
  };
  const listeners: ((userId: string) => Promise<void>)[] = [];
  const consent = {
    check: jest.fn().mockResolvedValue({ allowed: true }),
    onConsentWithdrawn: jest.fn((listener) => listeners.push(listener)),
  };
  const gateway = {
    generateObject: jest
      .fn()
      .mockResolvedValue({ status: 'ok', value: GOOD, usage: {} }),
  };
  const service = new MemberNudgeService(
    nudges,
    taskRepo,
    users,
    chapters,
    consent as unknown as AiConsentService,
    gateway as unknown as AiGatewayService,
  );
  return { service, nudges, taskRepo, chapters, consent, gateway, listeners };
}

describe('MemberNudgeService.current', () => {
  it('writes a card for a task coming due, as the member', async () => {
    const { service, nudges, gateway } = setup();
    const view = await service.current(INPUT, NOW);

    expect(view).toMatchObject({
      kind: 'task_due_soon',
      title: GOOD.title,
      body: GOOD.body,
      start_here: GOOD.start_here,
      task_id: 'task-1',
      task_title: 'Book the formal venue',
      seen: false,
    });
    expect(gateway.generateObject).toHaveBeenCalledWith(
      'nudges.write',
      expect.objectContaining({ promptVersion: 'nudges.write@v1' }),
      { chapterId: 'chapter-1', actingUserId: 'user-1' },
    );
    expect(nudges.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: 'chapter-1',
        user_id: 'user-1',
        task_id: 'task-1',
        written_by: 'ai',
        expires_at: '2026-11-17T00:00:00.000Z',
      }),
    );
  });

  it("gives the model the member's first name and never anyone else's", async () => {
    const { service, gateway } = setup();
    await service.current(INPUT, NOW);
    const prompt = gateway.generateObject.mock.calls[0][1];
    expect(prompt.messages[0].content).toContain("Member's first name: Sam");
    expect(prompt.messages[0].content).not.toContain('Rivera');
    expect(prompt.messages[0].content).not.toContain('officer-1');
  });

  it('reads nothing and shows nothing when AI is off for the member', async () => {
    const { service, consent, nudges, taskRepo, gateway } = setup();
    consent.check.mockResolvedValue({
      allowed: false,
      reason: 'member_declined',
    });
    expect(await service.current(INPUT, NOW)).toBeNull();
    expect(nudges.close).not.toHaveBeenCalled();
    expect(taskRepo.findByChapter).not.toHaveBeenCalled();
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it('closes a card left showing when AI went off, and sweeps cards past their time', async () => {
    const { service, consent, nudges } = setup();
    consent.check.mockResolvedValue({
      allowed: false,
      reason: 'chapter_off',
    });
    nudges.findShowing.mockResolvedValue({ id: 'card-1' } as MemberNudge);
    expect(await service.current(INPUT, NOW)).toBeNull();
    expect(nudges.closeExpired).toHaveBeenCalledWith(
      'chapter-1',
      NOW.toISOString(),
    );
    expect(nudges.close).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      'card-1',
      expect.objectContaining({ status: 'expired' }),
    );
  });

  it('shows nothing while the chapter has tasks turned off', async () => {
    const { service, chapters, gateway } = setup();
    chapters.findById.mockResolvedValue({
      id: 'chapter-1',
      enabled_modules: { tasks: false },
    });
    expect(await service.current(INPUT, NOW)).toBeNull();
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it('returns the card already showing without calling the model', async () => {
    const { service, gateway, nudges } = setup({ showing: card() });
    const view = await service.current(INPUT, NOW);
    expect(view?.id).toBe('nudge-1');
    expect(gateway.generateObject).not.toHaveBeenCalled();
    expect(nudges.close).not.toHaveBeenCalled();
  });

  it('closes the showing card once the member started the task', async () => {
    const { service, nudges } = setup({
      showing: card(),
      tasks: [task({ status: TaskStatus.IN_PROGRESS })],
    });
    expect(await service.current(INPUT, NOW)).toBeNull();
    expect(nudges.close).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      'nudge-1',
      {
        status: 'done',
        closed_at: NOW.toISOString(),
      },
    );
  });

  it('writes nothing new when the member turned cards off', async () => {
    const { service, nudges, gateway } = setup({ showing: card() });
    nudges.findSettings.mockResolvedValue({
      chapter_id: 'chapter-1',
      user_id: 'user-1',
      enabled: false,
      quiet_until: null,
      updated_at: ago(DAY),
    });
    expect(await service.current(INPUT, NOW)).toBeNull();
    expect(nudges.close).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      'nudge-1',
      expect.objectContaining({ status: 'expired' }),
    );
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it('does not call the model when no task is worth a card', async () => {
    const { service, gateway } = setup({
      tasks: [task({ due_date: '2026-12-20' })],
    });
    expect(await service.current(INPUT, NOW)).toBeNull();
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it('does not call the model within a day of the last card', async () => {
    const { service, nudges, gateway } = setup();
    nudges.findRecent.mockResolvedValue([
      card({
        status: 'done',
        created_at: ago(3_600_000),
        closed_at: ago(60_000),
      }),
    ]);
    expect(await service.current(INPUT, NOW)).toBeNull();
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it("uses Frapp's fixed sentence when the model's words fail a check", async () => {
    const { service, nudges, gateway } = setup();
    gateway.generateObject.mockResolvedValue({
      status: 'ok',
      value: { ...GOOD, body: 'Do not disappoint your brothers!' },
      usage: {},
    });
    const view = await service.current(INPUT, NOW);
    expect(view?.title).toBe('Coming up');
    expect(view?.body).toContain(
      '"Book the formal venue" is due Monday, November 16.',
    );
    expect(nudges.create).toHaveBeenCalledWith(
      expect.objectContaining({ written_by: 'fixed' }),
    );
  });

  it.each([
    ['a refusal', { status: 'refused', category: null }],
    ['an answer that is not a card', { status: 'invalid_output' }],
    [
      'a spend cap',
      { status: 'unavailable', reason: 'spend_cap', detail: 'member_cap' },
    ],
  ])('uses the fixed sentence on %s', async (_label, result) => {
    const { service, gateway, nudges } = setup();
    gateway.generateObject.mockResolvedValue(result);
    expect((await service.current(INPUT, NOW))?.title).toBe('Coming up');
    expect(nudges.create).toHaveBeenCalledWith(
      expect.objectContaining({ written_by: 'fixed' }),
    );
  });

  it('uses the fixed sentence when the provider fails', async () => {
    const { service, gateway } = setup();
    gateway.generateObject.mockRejectedValue(new Error('timeout'));
    expect((await service.current(INPUT, NOW))?.title).toBe('Coming up');
  });

  it('shows no card when the gateway says AI is off after all', async () => {
    const { service, gateway, nudges } = setup();
    gateway.generateObject.mockResolvedValue({
      status: 'unavailable',
      reason: 'consent',
      detail: 'member_declined',
    });
    expect(await service.current(INPUT, NOW)).toBeNull();
    expect(nudges.create).not.toHaveBeenCalled();
  });

  it('writes nothing when the member left before the model answered', async () => {
    const { service, gateway, nudges } = setup();
    const abort = new AbortController();
    gateway.generateObject.mockImplementation(async () => {
      abort.abort();
      throw new Error('aborted');
    });
    expect(
      await service.current({ ...INPUT, signal: abort.signal }, NOW),
    ).toBeNull();
    expect(nudges.create).not.toHaveBeenCalled();
  });

  it("shows the other device's card when it got there first", async () => {
    const { service, nudges } = setup();
    nudges.create.mockResolvedValue(null);
    nudges.findShowing
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(card({ id: 'theirs' }));
    expect((await service.current(INPUT, NOW))?.id).toBe('theirs');
  });
});

describe('MemberNudgeService, the member closing and switching', () => {
  it('closes a card on Not now and starts no quiet stretch', async () => {
    const { service, nudges } = setup();
    await service.dismiss('chapter-1', 'user-1', 'nudge-1', 'not_now', NOW);
    expect(nudges.close).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      'nudge-1',
      {
        status: 'dismissed',
        dismiss_reason: 'not_now',
        closed_at: NOW.toISOString(),
      },
    );
    expect(nudges.saveSettings).not.toHaveBeenCalled();
  });

  it('keeps new cards away for two weeks on Fewer like this', async () => {
    const { service, nudges } = setup();
    await service.dismiss('chapter-1', 'user-1', 'nudge-1', 'fewer', NOW);
    expect(nudges.saveSettings).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      { quiet_until: '2026-11-27T15:00:00.000Z' },
      NOW.toISOString(),
    );
  });

  it("answers 404 for a card that is not the caller's showing card", async () => {
    const { service, nudges } = setup();
    nudges.close.mockResolvedValue(false);
    await expect(
      service.dismiss('chapter-1', 'user-1', 'other', 'not_now', NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('closes the showing card when the member turns cards off', async () => {
    const { service, nudges } = setup({ showing: card() });
    expect(await service.setEnabled('chapter-1', 'user-1', false, NOW)).toEqual(
      {
        enabled: false,
      },
    );
    expect(nudges.close).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      'nudge-1',
      expect.objectContaining({ status: 'expired' }),
    );
  });

  it('ends the quiet stretch when the member turns cards back on', async () => {
    const { service, nudges } = setup();
    await service.setEnabled('chapter-1', 'user-1', true, NOW);
    expect(nudges.saveSettings).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      { enabled: true, quiet_until: null },
      NOW.toISOString(),
    );
  });

  it("deletes a member's cards when they say No on the AI sheet", async () => {
    const { service, nudges, listeners } = setup();
    service.onModuleInit();
    await listeners[0]?.('user-1');
    expect(nudges.deleteByUser).toHaveBeenCalledWith('user-1');
  });
});
