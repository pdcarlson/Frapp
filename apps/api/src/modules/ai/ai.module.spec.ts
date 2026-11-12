import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AI_CONSENT_CHECK } from '#domain/adapters/ai-consent-check.interface';
import { AI_SPEND_RESERVATION } from '#domain/adapters/ai-spend-reservation.interface';
import { AI_USAGE_RECORDER } from '#domain/adapters/ai-usage-recorder.interface';
import { AI_CONSENT_SHEET } from '#domain/constants/ai-consent-sheet';
import type {
  ChapterAiSettings,
  UserAiConsent,
} from '#domain/entities/ai-consent.entity';
import { AI_CONSENT_REPOSITORY } from '#domain/repositories/ai-consent.repository.interface';
import { CHAPTER_AUDIT_LOG_REPOSITORY } from '#domain/repositories/chapter-audit-log.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import { AiGatewayService } from '../../application/services/ai/ai-gateway.service';
import { AnalyticsService } from '../../application/services/analytics.service';
import { AiConsentService } from '../../application/services/ai/ai-consent.service';
import { DiscardingAiUsageRecorder } from '../../infrastructure/ai/discarding-ai-usage-recorder';
import { UnlimitedAiSpendReservation } from '../../infrastructure/ai/unlimited-ai-spend-reservation';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AiConsentSeamModule } from './ai-consent-seam.module';
import { AiSpendSeamModule } from './ai-spend-seam.module';
import { AiUsageSeamModule } from './ai-usage-seam.module';
import { AiModule } from './ai.module';

const track = jest.fn().mockResolvedValue(undefined);

// The consent tables, in memory: chapter `c` with Ask on, and member `u`'s
// answer, which each test sets.
const consentRows: {
  settings: ChapterAiSettings | null;
  consent: UserAiConsent | null;
} = {
  settings: null,
  consent: null,
};
const fakeConsentRepository = {
  findChapterSettings: jest.fn(() => Promise.resolve(consentRows.settings)),
  findConsent: jest.fn(() => Promise.resolve(consentRows.consent)),
};

@Global()
@Module({
  providers: [{ provide: AnalyticsService, useValue: { track } }],
  exports: [AnalyticsService],
})
class FakeAnalyticsModule {}

// The consent routes' guards take the Supabase client, which the app's
// global SupabaseModule provides. Nothing here calls it.
@Global()
@Module({
  providers: [{ provide: SUPABASE_CLIENT, useValue: {} }],
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
      .overrideProvider(AI_CONSENT_REPOSITORY)
      .useValue(fakeConsentRepository)
      .overrideProvider(ROLE_REPOSITORY)
      .useValue({})
      .overrideProvider(CHAPTER_AUDIT_LOG_REPOSITORY)
      .useValue({})
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
    consentRows.settings = null;
    consentRows.consent = null;
  });

  it('binds consent to the consent gates, and the other seams to their no-op defaults', async () => {
    const moduleRef = await compile({});
    expect(
      moduleRef.select(AiConsentSeamModule).get<unknown>(AI_CONSENT_CHECK),
    ).toBeInstanceOf(AiConsentService);
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

  it('refuses a call for a member who has not said yes, or in a chapter with the family off', async () => {
    const moduleRef = await compile({ AI_PROVIDER: 'scripted' });
    process.env.AI_ENABLED = 'true';
    const ask = () =>
      moduleRef
        .get(AiGatewayService)
        .generateCited(
          'ask.answer',
          { promptVersion: 'ask@v1', messages: [], sources: [] },
          { chapterId: 'c', actingUserId: 'u' },
        );

    await expect(ask()).resolves.toEqual({
      status: 'unavailable',
      reason: 'consent',
      detail: 'chapter_off',
    });

    consentRows.settings = {
      chapter_id: 'c',
      ask_enabled: true,
      meeting_notes_enabled: false,
      chat_source_enabled: false,
      updated_by: 'p',
      updated_at: '2026-11-12T00:00:00.000Z',
    };
    await expect(ask()).resolves.toEqual({
      status: 'unavailable',
      reason: 'consent',
      detail: 'member_declined',
    });
    expect(track).not.toHaveBeenCalled();
  });

  it('serves a call end to end through the scripted adapter', async () => {
    const moduleRef = await compile({ AI_PROVIDER: 'scripted' });
    process.env.AI_ENABLED = 'true';
    consentRows.settings = {
      chapter_id: 'c',
      ask_enabled: true,
      meeting_notes_enabled: false,
      chat_source_enabled: false,
      updated_by: 'p',
      updated_at: '2026-11-12T00:00:00.000Z',
    };
    consentRows.consent = {
      user_id: 'u',
      sheet_version: AI_CONSENT_SHEET.version,
      accepted: true,
      answered_at: '2026-11-12T00:00:00.000Z',
    };

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
