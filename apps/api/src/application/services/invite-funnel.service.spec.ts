import { InviteFunnelService } from './invite-funnel.service';
import type { AnalyticsService } from './analytics.service';
import type { IInviteRepository } from '#domain/repositories/invite.repository.interface';

describe('InviteFunnelService (#5663)', () => {
  const VISIT = '6f1c2a34-9b8d-4e5f-a1b2-c3d4e5f60718';
  let findByToken: jest.Mock;
  let trackInviteVisit: jest.Mock;
  let service: InviteFunnelService;

  beforeEach(() => {
    findByToken = jest.fn();
    trackInviteVisit = jest.fn().mockResolvedValue(undefined);
    service = new InviteFunnelService(
      { findByToken } as unknown as IInviteRepository,
      { trackInviteVisit } as unknown as AnalyticsService,
    );
  });

  it("records a step under the invite's chapter, with only that step's fields", async () => {
    findByToken.mockResolvedValue({ chapter_id: 'chapter-1' });

    await service.recordStep(
      'tok',
      VISIT,
      // A stray `reason` on a card view is dropped, not recorded.
      {
        step: 'card-viewed',
        state: 'expired',
        signed_in: true,
        reason: 'gone',
      },
      { app: 'web' },
    );

    expect(trackInviteVisit).toHaveBeenCalledWith(
      'invite-card-viewed',
      'chapter-1',
      VISIT,
      { properties: { state: 'expired', signed_in: true }, app: 'web' },
    );
  });

  it('records the way in for sign-in-started', async () => {
    findByToken.mockResolvedValue({ chapter_id: 'chapter-1' });

    await service.recordStep(
      'tok',
      VISIT,
      { step: 'sign-in-started', method: 'apple' },
      { app: 'mobile' },
    );

    expect(trackInviteVisit).toHaveBeenCalledWith(
      'invite-sign-in-started',
      'chapter-1',
      VISIT,
      { properties: { method: 'apple' }, app: 'mobile' },
    );
  });

  it('records nothing for an unknown token, or one the lookup fails on', async () => {
    findByToken
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('db down'));

    await service.recordStep('nope', VISIT, { step: 'card-viewed' }, {});
    await service.recordStep('tok', VISIT, { step: 'card-viewed' }, {});

    expect(trackInviteVisit).not.toHaveBeenCalled();
  });

  it('records the join under the visit, with no properties of its own', async () => {
    await service.recordJoined('chapter-1', VISIT, { app: 'web' });

    expect(trackInviteVisit).toHaveBeenCalledWith(
      'invite-joined',
      'chapter-1',
      VISIT,
      { app: 'web' },
    );
  });
});
