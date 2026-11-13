import { ForbiddenException } from '@nestjs/common';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import type { AiConsentService } from '../ai/ai-consent.service';
import type { AiGatewayService } from '../ai/ai-gateway.service';
import type { AiSuggestionService } from '../ai-suggestion.service';
import type { AnalyticsService } from '../analytics.service';
import type { RbacService } from '../rbac.service';
import { ActService } from './act.service';
import type { ActDraft, ActTool } from './act-tool';
import { CHAPTER, JORDAN, NOW, OFFICER, ZONE, plan } from './act-test-kit';

function tool(
  name: string,
  permission: string,
  module: string,
  draft: ActDraft = {
    status: 'draft',
    payload: { title: 'Book the bus' },
    notes: [],
  },
): ActTool & { draft: jest.Mock } {
  return {
    name,
    description: `${name} description`,
    permission,
    module,
    effect: 'propose',
    kind: 'task',
    draft: jest.fn().mockResolvedValue(draft),
  } as unknown as ActTool & { draft: jest.Mock };
}

function build(options: {
  permissions: string[];
  planned?: unknown;
  tools?: ActTool[];
}) {
  const points = tool('give_points', 'points:adjust', 'points');
  const task = tool('create_task', 'tasks:manage', 'tasks');
  const event = tool('create_event', 'events:create', 'events');
  const tools = options.tools ?? [points, task, event];
  const generateObject = jest.fn().mockResolvedValue(
    options.planned ?? {
      status: 'ok',
      value: plan({ action: 'create_task', title: 'Book the bus' }),
    },
  );
  const suggestions = {
    withdrawSource: jest.fn().mockResolvedValue(0),
    proposeBatch: jest.fn().mockResolvedValue({
      created: [{ id: 'suggestion-1', kind: 'task' }],
    }),
  };
  const analytics = { track: jest.fn().mockResolvedValue(undefined) };
  const consent = { check: jest.fn().mockResolvedValue({ allowed: true }) };
  const service = new ActService(
    { generateObject } as unknown as AiGatewayService,
    consent as unknown as AiConsentService,
    {
      getEffectivePermissions: jest.fn().mockResolvedValue(options.permissions),
    } as unknown as RbacService,
    suggestions as unknown as AiSuggestionService,
    analytics as unknown as AnalyticsService,
    tools,
  );
  return {
    service,
    generateObject,
    suggestions,
    analytics,
    consent,
    points,
    task,
    event,
  };
}

const input = (
  request: string,
  enabledModules: Record<string, boolean> | null = null,
) => ({
  chapterId: CHAPTER,
  userId: OFFICER,
  enabledModules,
  timeZone: ZONE,
  request,
});

const OFFICER_HOLDS = [
  'ai:use',
  'ai:act',
  'members:view',
  'tasks:manage',
  'points:adjust',
];

describe('ActService', () => {
  describe('who may act', () => {
    it('refuses a member without ai:act before any model call, whatever else they hold', async () => {
      const { service, generateObject, suggestions } = build({
        permissions: [
          'ai:use',
          'tasks:manage',
          'points:adjust',
          'events:create',
        ],
      });
      await expect(
        service.act(input('give Jordan 5 points'), NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.availableActions(input(''))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.proposePointsForEvent(
          { ...input(''), eventId: 'e', amount: 5, reason: null },
          NOW,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(generateObject).not.toHaveBeenCalled();
      expect(suggestions.proposeBatch).not.toHaveBeenCalled();
    });

    it('offers only the actions whose own permission the member holds', async () => {
      const { service } = build({ permissions: OFFICER_HOLDS });
      expect(await service.availableActions(input(''))).toEqual([
        'give_points',
        'create_task',
      ]);
    });

    it('offers nothing from a module the chapter has off', async () => {
      const { service } = build({ permissions: OFFICER_HOLDS });
      expect(
        await service.availableActions(input('', { points: false })),
      ).toEqual(['create_task']);
    });

    it('refuses a member who cannot see members, as the request route does, for a caller that is not that route', async () => {
      const { service, generateObject } = build({
        permissions: ['ai:use', 'ai:act', 'tasks:manage'],
      });
      await expect(
        service.act(input('make a task'), NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(generateObject).not.toHaveBeenCalled();
    });

    it('ai:act alone offers nothing, and no model is called', async () => {
      const { service, generateObject } = build({
        permissions: ['ai:use', 'ai:act', 'members:view'],
      });
      expect(await service.act(input('give Jordan 5 points'), NOW)).toEqual({
        status: 'no_action',
        available: [],
      });
      expect(generateObject).not.toHaveBeenCalled();
    });
  });

  describe('what the planning call is shown', () => {
    it("is the member's own words and the offered actions, and nothing else", async () => {
      const { service, generateObject } = build({ permissions: OFFICER_HOLDS });
      await service.act(input('make a task for Jordan to book the bus'), NOW);
      expect(generateObject).toHaveBeenCalledTimes(1);
      const [task, request, context] = generateObject.mock.calls[0] as [
        string,
        { system: string; messages: { role: string; content: string }[] },
        unknown,
      ];
      expect(task).toBe('act.plan');
      expect(context).toEqual({ chapterId: CHAPTER, actingUserId: OFFICER });
      expect(request.messages).toEqual([
        {
          role: 'user',
          content: [
            'Request: make a task for Jordan to book the bus',
            '',
            'Actions:',
            '- give_points: give_points description',
            '- create_task: create_task description',
          ].join('\n'),
        },
      ]);
      // The action the member may not take is not there to be picked.
      expect(request.messages[0].content).not.toContain('create_event');
      expect(request.system).not.toContain('create_event');
      expect(request.system).toContain(
        'Today is 2026-11-12, Thursday, November 12, 2026',
      );
    });
  });

  describe('a request inside a conversation', () => {
    it("shows the planner the member's own earlier messages, the last three, before the request", async () => {
      const { service, generateObject } = build({ permissions: OFFICER_HOLDS });
      await service.act(
        {
          ...input('5, for cleaning the kitchen'),
          earlier: [
            'who is the treasurer?',
            'when is formal?',
            'what are the dues?',
            'give Jordan points',
          ],
        },
        NOW,
      );
      const [, request] = generateObject.mock.calls[0] as [
        string,
        { messages: { role: string; content: string }[] },
      ];
      expect(request.messages).toEqual([
        {
          role: 'user',
          content: [
            'Earlier in the conversation the officer wrote:',
            '- when is formal?',
            '- what are the dues?',
            '- give Jordan points',
            '',
            'Request: 5, for cleaning the kitchen',
            '',
            'Actions:',
            '- give_points: give_points description',
            '- create_task: create_task description',
          ].join('\n'),
        },
      ]);
    });

    it('leaves earlier cards waiting, so each one in the thread can still be confirmed', async () => {
      const { service, suggestions } = build({ permissions: OFFICER_HOLDS });
      const outcome = await service.act(
        { ...input('make a task'), keepEarlier: true },
        NOW,
      );
      expect(outcome).toMatchObject({ status: 'proposed' });
      expect(suggestions.withdrawSource).not.toHaveBeenCalled();
      expect(suggestions.proposeBatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('what the planning call can cause', () => {
    it('an ordinary "not available" when the provider fails, not a server error', async () => {
      const { service, generateObject, suggestions } = build({
        permissions: OFFICER_HOLDS,
      });
      generateObject.mockRejectedValue(
        new LanguageModelError('timeout', 'scripted', {}),
      );
      expect(await service.act(input('give Jordan 5 points'), NOW)).toEqual({
        status: 'unavailable',
        reason: 'not_available',
      });
      expect(suggestions.proposeBatch).not.toHaveBeenCalled();
    });

    it('nothing, when it names an action the member was not offered', async () => {
      const { service, event, suggestions } = build({
        permissions: OFFICER_HOLDS,
        planned: {
          status: 'ok',
          value: plan({ action: 'create_event', title: 'x' }),
        },
      });
      expect(await service.act(input('whatever'), NOW)).toEqual({
        status: 'no_action',
        available: ['give_points', 'create_task'],
      });
      expect(event.draft).not.toHaveBeenCalled();
      expect(suggestions.proposeBatch).not.toHaveBeenCalled();
    });

    it('nothing, when it names an action that does not exist', async () => {
      const { service, suggestions } = build({
        permissions: OFFICER_HOLDS,
        planned: { status: 'ok', value: plan({ action: 'delete_chapter' }) },
      });
      expect((await service.act(input('whatever'), NOW)).status).toBe(
        'no_action',
      );
      expect(suggestions.proposeBatch).not.toHaveBeenCalled();
    });

    it('at most a proposal: no tool writes, and one draft is run', async () => {
      const { service, task, points, suggestions } = build({
        permissions: OFFICER_HOLDS,
      });
      await service.act(input('make a task'), NOW);
      expect(task.draft).toHaveBeenCalledTimes(1);
      expect(points.draft).not.toHaveBeenCalled();
      expect(suggestions.proposeBatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('the proposal', () => {
    it('is saved for the asker alone, replaces their last one, and pushes nobody', async () => {
      const { service, suggestions, task } = build({
        permissions: OFFICER_HOLDS,
      });
      const outcome = await service.act(input('make a task'), NOW);
      expect(outcome).toMatchObject({
        status: 'proposed',
        action: 'create_task',
        suggestion: { id: 'suggestion-1' },
        notes: [],
      });
      expect(suggestions.withdrawSource).toHaveBeenCalledWith(CHAPTER, {
        type: 'request',
        id: OFFICER,
      });
      expect(
        suggestions.withdrawSource.mock.invocationCallOrder[0],
      ).toBeLessThan(suggestions.proposeBatch.mock.invocationCallOrder[0]);
      expect(suggestions.proposeBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterId: CHAPTER,
          requestedFor: OFFICER,
          source: { type: 'request', id: OFFICER, title: 'Ask Frapp' },
          proposals: [{ kind: 'task', payload: { title: 'Book the bus' } }],
          notify: [],
          expiresWithinDays: 1,
        }),
      );
      expect(task.draft).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_task' }),
        expect.objectContaining({
          chapterId: CHAPTER,
          userId: OFFICER,
          timeZone: ZONE,
          now: NOW,
        }),
      );
    });

    it('sends analytics the action and a count, never the words', async () => {
      const { service, analytics } = build({ permissions: OFFICER_HOLDS });
      await service.act(
        input('make a task for Jordan to book the secret bus'),
        NOW,
      );
      expect(analytics.track).toHaveBeenCalledWith('ai-act-proposed', OFFICER, {
        chapterId: CHAPTER,
        properties: { action: 'create_task', open_notes: 0 },
      });
      expect(JSON.stringify(analytics.track.mock.calls)).not.toContain('bus');
    });

    it('leaves what the member asked before alone when the new request is unclear', async () => {
      const unclear = tool('create_task', 'tasks:manage', 'tasks', {
        status: 'unclear',
        missing: 'title',
      });
      const { service, suggestions } = build({
        permissions: OFFICER_HOLDS,
        tools: [unclear],
      });
      expect(await service.act(input('make a task'), NOW)).toEqual({
        status: 'unclear',
        action: 'create_task',
        missing: 'title',
      });
      expect(suggestions.withdrawSource).not.toHaveBeenCalled();
    });

    it("is unclear when the kind's own check turns the draft down", async () => {
      const { service, suggestions } = build({ permissions: OFFICER_HOLDS });
      suggestions.proposeBatch.mockResolvedValue({ created: [] });
      expect(await service.act(input('make a task'), NOW)).toEqual({
        status: 'unclear',
        action: 'create_task',
        missing: 'request',
      });
    });
  });

  it.each([
    [{ status: 'refused' }, { status: 'refused' }],
    [
      { status: 'invalid_output' },
      { status: 'unclear', action: null, missing: 'request' },
    ],
    [
      { status: 'unavailable', reason: 'consent', detail: 'chapter_off' },
      { status: 'unavailable', reason: 'chapter_off' },
    ],
    [
      { status: 'unavailable', reason: 'consent', detail: 'no_consent' },
      { status: 'unavailable', reason: 'consent_required' },
    ],
    [
      { status: 'unavailable', reason: 'spend_cap', detail: 'chapter_cap' },
      { status: 'unavailable', reason: 'chapter_limit' },
    ],
    [
      { status: 'unavailable', reason: 'spend_cap', detail: 'member_cap' },
      { status: 'unavailable', reason: 'member_limit' },
    ],
    [
      { status: 'unavailable', reason: 'disabled' },
      { status: 'unavailable', reason: 'not_available' },
    ],
  ])('answers %j as %j and proposes nothing', async (planned, expected) => {
    const { service, suggestions } = build({
      permissions: OFFICER_HOLDS,
      planned,
    });
    expect(await service.act(input('make a task'), NOW)).toEqual(expected);
    expect(suggestions.proposeBatch).not.toHaveBeenCalled();
  });

  describe('picking the event', () => {
    it('answers no_action to a member who is not offered points', async () => {
      const { service } = build({
        permissions: ['ai:act', 'members:view', 'tasks:manage'],
      });
      expect(
        await service.proposePointsForEvent(
          { ...input(''), eventId: JORDAN, amount: 5, reason: null },
          NOW,
        ),
      ).toEqual({ status: 'no_action', available: ['create_task'] });
    });
  });

  it('assertMayAct refuses when consent does', async () => {
    const { service, consent } = build({ permissions: OFFICER_HOLDS });
    await expect(
      service.assertMayAct(CHAPTER, OFFICER),
    ).resolves.toBeUndefined();
    consent.check.mockResolvedValue({ allowed: false, reason: 'chapter_off' });
    await expect(service.assertMayAct(CHAPTER, OFFICER)).rejects.toMatchObject({
      response: { code: 'ai.chapter_off' },
    });
  });
});
