import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AI_CONSENT_CHECK } from '#domain/adapters/ai-consent-check.interface';
import { AI_SPEND_RESERVATION } from '#domain/adapters/ai-spend-reservation.interface';
import { AI_USAGE_RECORDER } from '#domain/adapters/ai-usage-recorder.interface';
import { AiGatewayService } from '../../application/services/ai/ai-gateway.service';
import { AnalyticsService } from '../../application/services/analytics.service';
import { AllowAllAiConsentCheck } from '../../infrastructure/ai/allow-all-ai-consent-check';
import { DiscardingAiUsageRecorder } from '../../infrastructure/ai/discarding-ai-usage-recorder';
import { UnlimitedAiSpendReservation } from '../../infrastructure/ai/unlimited-ai-spend-reservation';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AiConsentSeamModule } from './ai-consent-seam.module';
import { AiSpendSeamModule } from './ai-spend-seam.module';
import { AiUsageSeamModule } from './ai-usage-seam.module';
import { AiModule } from './ai.module';

const track = jest.fn().mockResolvedValue(undefined);

@Global()
@Module({
  providers: [{ provide: AnalyticsService, useValue: { track } }],
  exports: [AnalyticsService],
})
class FakeAnalyticsModule {}

async function compile(env: Record<string, string>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return await Test.createTestingModule({ imports: [AiModule] })
      .overrideModule(AnalyticsModule)
      .useModule(FakeAnalyticsModule)
      .compile();
  } finally {
    process.env = saved;
  }
}

describe('AiModule', () => {
  const original = process.env.AI_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = original;
    track.mockClear();
  });

  it('binds each seam to its no-op default, from its own module', async () => {
    const moduleRef = await compile({});
    expect(
      moduleRef.select(AiConsentSeamModule).get<unknown>(AI_CONSENT_CHECK),
    ).toBeInstanceOf(AllowAllAiConsentCheck);
    expect(
      moduleRef.select(AiSpendSeamModule).get<unknown>(AI_SPEND_RESERVATION),
    ).toBeInstanceOf(UnlimitedAiSpendReservation);
    expect(
      moduleRef.select(AiUsageSeamModule).get<unknown>(AI_USAGE_RECORDER),
    ).toBeInstanceOf(DiscardingAiUsageRecorder);
  });

  it('boots with nothing configured and answers "not available"', async () => {
    const moduleRef = await compile({});
    const gateway = moduleRef.get(AiGatewayService);

    delete process.env.AI_ENABLED;
    await expect(
      gateway.generateCited(
        'ask.answer',
        { promptVersion: 'ask@v1', messages: [], sources: [] },
        { chapterId: 'c', actingUserId: 'u' },
      ),
    ).resolves.toEqual({ status: 'unavailable', reason: 'disabled' });

    // Switched on with no credential: still no call.
    process.env.AI_ENABLED = 'true';
    await expect(
      gateway.generateCited(
        'ask.answer',
        { promptVersion: 'ask@v1', messages: [], sources: [] },
        { chapterId: 'c', actingUserId: 'u' },
      ),
    ).resolves.toEqual({ status: 'unavailable', reason: 'not_configured' });
    expect(track).not.toHaveBeenCalled();
  });

  it('serves a call end to end through the scripted adapter', async () => {
    const moduleRef = await compile({ AI_PROVIDER: 'scripted' });
    process.env.AI_ENABLED = 'true';

    const result = await moduleRef.get(AiGatewayService).generateCited(
      'ask.answer',
      {
        promptVersion: 'ask@v1',
        messages: [{ role: 'user', content: 'When is formal?' }],
        sources: [],
      },
      { chapterId: 'c', actingUserId: 'u' },
    );

    expect(result).toMatchObject({
      status: 'ok',
      text: 'Scripted reply for ask.answer.',
      citations: [],
    });
    expect(track).toHaveBeenCalledTimes(1);
  });
});
