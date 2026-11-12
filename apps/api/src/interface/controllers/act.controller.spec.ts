import { ForbiddenException } from '@nestjs/common';
import type { ActService } from '../../application/services/act/act.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ActController } from './act.controller';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';

function build() {
  const service = {
    assertMayAct: jest.fn(async () => undefined),
    availableActions: jest.fn(async () => ['create_task']),
    act: jest.fn(async () => ({
      status: 'no_action',
      available: ['create_task'],
    })),
    proposePointsForEvent: jest.fn(async () => ({
      status: 'unclear',
      action: 'give_points',
      missing: 'nobody_attended',
    })),
  };
  return {
    controller: new ActController(service as unknown as ActService),
    service,
  };
}

describe('ActController', () => {
  it('is behind the AI switch, sign-in, the chapter, and both ai:use and ai:act', () => {
    expect(Reflect.getMetadata('__guards__', ActController)).toEqual([
      AiEnabledGuard,
      SupabaseAuthGuard,
      ChapterGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ActController)).toEqual([
      'members:view',
      'ai:use',
      'ai:act',
    ]);
  });

  it('lists the actions the caller could ask for', async () => {
    const { controller, service } = build();
    expect(await controller.status(CHAPTER, USER, { points: false })).toEqual({
      actions: ['create_task'],
    });
    expect(service.availableActions).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterId: CHAPTER,
        userId: USER,
        enabledModules: { points: false },
      }),
    );
  });

  it('checks consent, then acts as the caller in their chapter and zone', async () => {
    const { controller, service } = build();
    const answer = await controller.act(
      CHAPTER,
      USER,
      null,
      'America/Chicago',
      {
        request: 'make a task',
      },
    );
    expect(service.assertMayAct).toHaveBeenCalledWith(CHAPTER, USER);
    expect(service.act).toHaveBeenCalledWith({
      chapterId: CHAPTER,
      userId: USER,
      enabledModules: null,
      timeZone: 'America/Chicago',
      request: 'make a task',
    });
    expect(answer).toEqual({
      status: 'no_action',
      action: null,
      suggestion: null,
      notes: [],
      event_choice: null,
      missing: null,
      reason: null,
      available_actions: ['create_task'],
    });
  });

  it('falls back to a known zone when the header is not one', async () => {
    const { controller, service } = build();
    await controller.act(CHAPTER, USER, null, 'Mars/Olympus', { request: 'x' });
    const [input] = service.act.mock.calls[0] as unknown as [
      { timeZone: string },
    ];
    expect(input.timeZone).not.toBe('Mars/Olympus');
  });

  it('calls no model when consent refuses', async () => {
    const { controller, service } = build();
    service.assertMayAct.mockRejectedValue(new ForbiddenException());
    await expect(
      controller.act(CHAPTER, USER, null, undefined, { request: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.act).not.toHaveBeenCalled();
  });

  it('checks consent on the event pick too, which calls no model to check it', async () => {
    const { controller, service } = build();
    service.assertMayAct.mockRejectedValue(new ForbiddenException());
    await expect(
      controller.eventAudience(CHAPTER, USER, null, undefined, {
        event_id: EVENT,
        amount: 5,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.assertMayAct).toHaveBeenCalledWith(CHAPTER, USER);
    expect(service.proposePointsForEvent).not.toHaveBeenCalled();
  });

  it('passes the picked event on, with the chapter from the guard', async () => {
    const { controller, service } = build();
    const answer = await controller.eventAudience(
      CHAPTER,
      USER,
      null,
      undefined,
      {
        event_id: EVENT,
        amount: 5,
      },
    );
    expect(service.proposePointsForEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterId: CHAPTER,
        userId: USER,
        eventId: EVENT,
        amount: 5,
        reason: null,
      }),
    );
    expect(answer).toMatchObject({
      status: 'unclear',
      action: 'give_points',
      missing: 'nobody_attended',
    });
  });
});
