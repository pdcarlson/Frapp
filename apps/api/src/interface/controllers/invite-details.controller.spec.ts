import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { InviteFunnelStepDto } from '../dtos/invite.dto';
import { InviteDetailsController } from './invite-details.controller';
import type { InviteService } from '../../application/services/invite.service';
import type { InviteFunnelService } from '../../application/services/invite-funnel.service';

/**
 * `POST /v1/invites/funnel` (#5663): needs no account, so its DTO is the only
 * gate on what reaches PostHog, and the request is the only label of which
 * app sent the step.
 */
describe('InviteDetailsController.funnelStep', () => {
  const VISIT = '6f1c2a34-9b8d-4e5f-a1b2-c3d4e5f60718';

  it('records the step labelled with the app the request came from', async () => {
    const recordStep = jest.fn().mockResolvedValue(undefined);
    const controller = new InviteDetailsController(
      {} as InviteService,
      { recordStep } as unknown as InviteFunnelService,
    );
    const dto = {
      token: 'tok',
      visit_id: VISIT,
      step: 'sign-in-started',
      method: 'apple',
    } as InviteFunnelStepDto;

    await controller.funnelStep(dto, {
      headers: { 'x-client-version': 'ios/0.14.0+21' },
    } as never);
    await controller.funnelStep(dto, {
      headers: { origin: 'https://app.frapp.live' },
    } as never);

    expect(recordStep).toHaveBeenNthCalledWith(1, 'tok', VISIT, dto, {
      app: 'mobile',
      appVersion: { version: '0.14.0', build: '21' },
    });
    expect(recordStep).toHaveBeenNthCalledWith(2, 'tok', VISIT, dto, {
      app: 'web',
      appVersion: undefined,
    });
  });
});

describe('InviteFunnelStepDto through the API ValidationPipe', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const meta: ArgumentMetadata = {
    type: 'body',
    metatype: InviteFunnelStepDto,
    data: '',
  };
  const VISIT = '6f1c2a34-9b8d-4e5f-a1b2-c3d4e5f60718';
  const ok = { token: 'tok', visit_id: VISIT, step: 'card-viewed' };

  it('accepts each step the card sends', async () => {
    await expect(
      pipe.transform({ ...ok, state: 'locked', signed_in: false }, meta),
    ).resolves.toBeInstanceOf(InviteFunnelStepDto);
    await expect(
      pipe.transform({ ...ok, step: 'join-failed', reason: 'gone' }, meta),
    ).resolves.toBeInstanceOf(InviteFunnelStepDto);
  });

  it.each([
    ['a step outside the closed set', { ...ok, step: 'anything' }],
    ['a visit id that is not a UUID', { ...ok, visit_id: 'me@school.edu' }],
    ['a way in outside the set', { ...ok, method: 'facebook' }],
    ['a state outside the set', { ...ok, state: 'gone' }],
    ['a reason outside the set', { ...ok, reason: 'Token has expired' }],
    ['a string for signed_in', { ...ok, signed_in: 'true' }],
    ['a field the step does not know', { ...ok, email: 'me@school.edu' }],
  ])('refuses %s', async (_label, body) => {
    await expect(pipe.transform(body, meta)).rejects.toThrow();
  });
});
