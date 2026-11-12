import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AI_CONSENT_CHECK } from '#domain/adapters/ai-consent-check.interface';
import { AI_SPEND_RESERVATION } from '#domain/adapters/ai-spend-reservation.interface';
import { AI_USAGE_RECORDER } from '#domain/adapters/ai-usage-recorder.interface';
import { AiGatewayService } from '../../application/services/ai/ai-gateway.service';
import { AiSpendLedgerService } from '../../application/services/ai/ai-spend-ledger.service';
import { AnalyticsService } from '../../application/services/analytics.service';
import { AllowAllAiConsentCheck } from '../../infrastructure/ai/allow-all-ai-consent-check';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
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

const RESERVATION = '0c000000-0000-4000-8000-000000000714';
const rpc = jest.fn((fn: string) => {
  if (fn === 'reserve_ai_spend') {
    return Promise.resolve({
      data: [
        {
          reservation_id: RESERVATION,
          refused: null,
          platform_spent_before: 0,
          platform_spent_after: 1,
        },
      ],
      error: null,
    });
  }
  if (fn === 'settle_ai_spend') {
    return Promise.resolve({ data: 'settled', error: null });
  }
  return Promise.resolve({
    data: null,
    error: { message: `unexpected ${fn}` },
  });
});

/** The app's Supabase module is global; this stands in for it. */
@Global()
@Module({
  providers: [{ provide: SUPABASE_CLIENT, useValue: { rpc } }],
  exports: [SUPABASE_CLIENT],
})
class FakeSupabaseModule {}

async function compile(env: Record<string, string>) {
  const saved = { ...process.env };
  // Only what the test passes: a key or a switch exported in the shell (or
  // injected by Infisical once a real key exists) must not build the live
  // adapter here and send a unit test's prompt to the provider.
  delete process.env.AI_ENABLED;
  delete process.env.AI_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  Object.assign(process.env, env);
  try {
    return await Test.createTestingModule({
      imports: [FakeSupabaseModule, AiModule],
    })
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
    rpc.mockClear();
  });

  it('binds each seam from its own module: spend and usage to one ledger', async () => {
    const moduleRef = await compile({});
    expect(
      moduleRef.select(AiConsentSeamModule).get<unknown>(AI_CONSENT_CHECK),
    ).toBeInstanceOf(AllowAllAiConsentCheck);
    const spend = moduleRef
      .select(AiSpendSeamModule)
      .get<unknown>(AI_SPEND_RESERVATION);
    const usage = moduleRef
      .select(AiUsageSeamModule)
      .get<unknown>(AI_USAGE_RECORDER);
    expect(spend).toBeInstanceOf(AiSpendLedgerService);
    // One instance: a hold and its settlement go through the same ledger.
    expect(usage).toBe(spend);
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
    // Nothing was held: a call that is not made touches no ledger.
    expect(rpc).not.toHaveBeenCalled();
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

    // Held before the call, settled after it, against the same row, with no
    // text in either.
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual([
      'reserve_ai_spend',
      'settle_ai_spend',
    ]);
    const [[, held], [, settled]] = rpc.mock.calls as unknown as [
      [string, Record<string, unknown>],
      [string, Record<string, unknown>],
    ];
    expect(held).toMatchObject({
      p_chapter_id: 'c',
      p_user_id: 'u',
      p_task: 'ask.answer',
      p_provider: 'scripted',
      // Scripted replies cost nothing: no platform cap.
      p_platform_cap_micro_usd: null,
    });
    expect(settled).toMatchObject({
      p_reservation_id: RESERVATION,
      p_outcome: 'completed',
      p_bill_reservation: false,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('When is formal?');
  });
});
