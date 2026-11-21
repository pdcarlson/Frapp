import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { configureApp } from '../../bootstrap';
import { BackworkFillService } from '../../application/services/backwork-fill/backwork-fill.service';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { CustomThrottlerGuard } from '../guards/custom-throttler.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { BackworkFillController } from './backwork-fill.controller';

jest.mock('../../infrastructure/analytics/posthog-runtime', () => ({
  enqueueSanitizedLog: jest.fn(),
  captureSentryErrorCorrelated: jest.fn(),
}));

const DRAFT = '0a000000-0000-4000-8000-0000000000d1';

/**
 * The fill's rate limit, through the app's real throttler guard and its
 * buckets as `AppModule` registers them. An officer's bulk upload of 200
 * files lands drafts no faster than 10 upload URLs a minute, and the review
 * table fills them as they land, so the fill is held to the same 10 and waits
 * out a 429 (`use-draft-autofill.ts`). The other guards are let through:
 * they have their own specs, and this one is about the count.
 */
describe('POST /v1/backwork/drafts/:id/fill throttling', () => {
  let app: INestApplication;
  const fill = jest.fn();

  beforeAll(async () => {
    const pass = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'read', ttl: 60_000, limit: 100 },
          { name: 'write', ttl: 60_000, limit: 30 },
        ]),
      ],
      controllers: [BackworkFillController],
      providers: [
        { provide: BackworkFillService, useValue: { fill } },
        { provide: APP_GUARD, useClass: CustomThrottlerGuard },
      ],
    })
      .overrideGuard(AiEnabledGuard)
      .useValue(pass)
      .overrideGuard(SupabaseAuthGuard)
      .useValue(pass)
      .overrideGuard(ChapterGuard)
      .useValue(pass)
      .overrideGuard(PermissionsGuard)
      .useValue(pass)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('takes 10 fills a minute from one member, then answers 429', async () => {
    fill.mockResolvedValue({ status: 'not_redacted' });
    for (let i = 0; i < 10; i += 1) {
      await request(app.getHttpServer())
        .post(`/v1/backwork/drafts/${DRAFT}/fill`)
        .expect(200);
    }
    await request(app.getHttpServer())
      .post(`/v1/backwork/drafts/${DRAFT}/fill`)
      .expect(429);
    expect(fill).toHaveBeenCalledTimes(10);
  });
});
