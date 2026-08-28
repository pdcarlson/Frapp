import { Test, TestingModule } from '@nestjs/testing';
import { ACTIVATION_MILESTONES } from '@repo/validation';
import { ActivationService } from './activation.service';
import { AnalyticsService } from './analytics.service';
import {
  ACTIVATION_MILESTONE_REPOSITORY,
  type IActivationMilestoneRepository,
} from '../../domain/repositories/activation-milestone.repository.interface';

describe('ActivationService', () => {
  let service: ActivationService;
  let mockRepo: jest.Mocked<IActivationMilestoneRepository>;
  let mockAnalytics: jest.Mocked<Pick<AnalyticsService, 'trackForChapter'>>;

  beforeEach(async () => {
    mockRepo = {
      recordFirst: jest.fn().mockResolvedValue(true),
    };

    mockAnalytics = {
      trackForChapter: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivationService,
        { provide: ACTIVATION_MILESTONE_REPOSITORY, useValue: mockRepo },
        { provide: AnalyticsService, useValue: mockAnalytics },
      ],
    }).compile();

    service = module.get(ActivationService);
  });

  it('records the milestone and emits an analytics event on the first occurrence', async () => {
    const isFirst = await service.record(
      'ch-1',
      'activation-first-invite-created',
    );

    expect(isFirst).toBe(true);
    expect(mockRepo.recordFirst).toHaveBeenCalledWith(
      'ch-1',
      'activation-first-invite-created',
    );
    expect(mockAnalytics.trackForChapter).toHaveBeenCalledWith(
      'activation-first-invite-created',
      'ch-1',
      { step: 2 },
    );
  });

  it('emits nothing when the milestone was already recorded', async () => {
    mockRepo.recordFirst.mockResolvedValue(false);

    const isFirst = await service.record(
      'ch-1',
      'activation-first-chat-message',
    );

    expect(isFirst).toBe(false);
    expect(mockAnalytics.trackForChapter).not.toHaveBeenCalled();
  });

  it('merges caller properties alongside the funnel step', async () => {
    await service.record('ch-1', 'activation-first-paid-module-enabled', {
      module: 'events',
    });

    expect(mockAnalytics.trackForChapter).toHaveBeenCalledWith(
      'activation-first-paid-module-enabled',
      'ch-1',
      { step: 5, module: 'events' },
    );
  });

  it('numbers every milestone by its position in the funnel', async () => {
    for (const [index, milestone] of ACTIVATION_MILESTONES.entries()) {
      mockAnalytics.trackForChapter.mockClear();
      await service.record('ch-1', milestone);
      expect(mockAnalytics.trackForChapter).toHaveBeenCalledWith(
        milestone,
        'ch-1',
        { step: index + 1 },
      );
    }
  });

  // The seven call sites are a checkout, an invite, a message send and a
  // chapter creation. Telemetry that can fail any of them is worse than no
  // telemetry, so both failure modes are swallowed — but the call must still
  // report that the milestone did not land.
  it('swallows a repository failure and reports not-first', async () => {
    mockRepo.recordFirst.mockRejectedValue(new Error('db down'));

    await expect(
      service.record('ch-1', 'activation-checkout-completed'),
    ).resolves.toBe(false);
    expect(mockAnalytics.trackForChapter).not.toHaveBeenCalled();
  });

  it('swallows an analytics failure after the milestone is already stored', async () => {
    mockAnalytics.trackForChapter.mockRejectedValue(new Error('provider 500'));

    await expect(
      service.record('ch-1', 'activation-checkout-completed'),
    ).resolves.toBe(false);
    // The row was still written — a provider outage must not cost the record,
    // which is the durable half of the funnel.
    expect(mockRepo.recordFirst).toHaveBeenCalled();
  });
});
