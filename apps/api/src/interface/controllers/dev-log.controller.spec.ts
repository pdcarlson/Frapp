import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import {
  DEV_LOG_ENV,
  hashDevLogToken,
} from '../../application/services/dev-log.service';
import { configureApp } from '../../bootstrap';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { DevLogModule } from '../../modules/dev-log/dev-log.module';

jest.mock('../../infrastructure/analytics/posthog-runtime', () => ({
  enqueueSanitizedLog: jest.fn(),
  captureSentryErrorCorrelated: jest.fn(),
}));

const TOKEN = 'c'.repeat(64);
const CHAPTER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const MERGED = {
  event: 'pr_merged',
  number: 40,
  title: 'Fix the badge',
  actor: 'Evan',
};

/**
 * Through the real module, guard and `configureApp` (the `/v1` prefix and the
 * global `ValidationPipe`), with only the two repositories replaced: what the
 * workflow depends on is the path, the token check, and what a body may hold.
 */
describe('POST /v1/integrations/dev-log', () => {
  let app: INestApplication;
  const saved = { ...process.env };
  const channelRepo = { findById: jest.fn() };
  const messageRepo = { insertIdempotent: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DevLogModule],
    })
      .useMocker((token) => (token === SUPABASE_CLIENT ? {} : undefined))
      .overrideProvider(CHAT_CHANNEL_REPOSITORY)
      .useValue(channelRepo)
      .overrideProvider(CHAT_MESSAGE_REPOSITORY)
      .useValue(messageRepo)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    process.env[DEV_LOG_ENV.tokenHash] = hashDevLogToken(TOKEN);
    process.env[DEV_LOG_ENV.chapterId] = CHAPTER_ID;
    process.env[DEV_LOG_ENV.channelId] = CHANNEL_ID;
    channelRepo.findById.mockReset().mockResolvedValue({
      id: CHANNEL_ID,
      archived_at: null,
    });
    messageRepo.insertIdempotent.mockReset().mockResolvedValue('inserted');
  });

  afterEach(() => {
    for (const name of Object.values(DEV_LOG_ENV)) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (body: object, token: string | null = TOKEN) => {
    const req = request(app.getHttpServer()).post('/v1/integrations/dev-log');
    return (
      token === null ? req : req.set('Authorization', `Bearer ${token}`)
    ).send(body);
  };

  it('posts with the right token', async () => {
    const res = await send(MERGED).expect(200);
    expect(res.body).toEqual({ status: 'posted' });
    expect(messageRepo.insertIdempotent).toHaveBeenCalledTimes(1);
  });

  it('answers duplicate, and writes nothing more, for a repeated event', async () => {
    messageRepo.insertIdempotent.mockResolvedValue('duplicate');
    const res = await send(MERGED).expect(200);
    expect(res.body).toEqual({ status: 'duplicate' });
  });

  it.each([
    ['no Authorization header', null],
    ['a wrong token', 'd'.repeat(64)],
    ['the stored hash instead of the token', hashDevLogToken(TOKEN)],
  ])('refuses %s with 401 and writes nothing', async (_name, token) => {
    await send(MERGED, token).expect(401);
    expect(channelRepo.findById).not.toHaveBeenCalled();
    expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
  });

  it('refuses a non-Bearer scheme', async () => {
    await request(app.getHttpServer())
      .post('/v1/integrations/dev-log')
      .set('Authorization', `Basic ${TOKEN}`)
      .send(MERGED)
      .expect(401);
  });

  it('is absent (404) on a deployment with no Dev log configured', async () => {
    delete process.env[DEV_LOG_ENV.tokenHash];
    await send(MERGED).expect(404);
    expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
  });

  it('cannot be pointed at another channel, chapter or sender by the body', async () => {
    // The whitelist refuses unknown keys outright, so none of these reach
    // the service; the channel always comes from the deployment's config.
    for (const extra of [
      { channel_id: '33333333-3333-4333-8333-333333333333' },
      { chapter_id: '33333333-3333-4333-8333-333333333333' },
      { sender_id: '33333333-3333-4333-8333-333333333333' },
      { content: 'anything I like' },
      { url: 'https://example.com' },
    ]) {
      await send({ ...MERGED, ...extra }).expect(400);
    }
    expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown event', { ...MERGED, event: 'announcement' }],
    ['a merged post with no number', { ...MERGED, number: undefined }],
    ['a title past the cap', { ...MERGED, title: 'x'.repeat(301) }],
    ['a summary with no date', { event: 'daily_summary' }],
    [
      'a summary with too many items',
      {
        event: 'daily_summary',
        date: '2026-11-11',
        in_progress: Array.from({ length: 61 }, (_, i) => ({
          number: i + 1,
          title: 't',
        })),
      },
    ],
    [
      'a summary item with an unknown key',
      {
        event: 'daily_summary',
        date: '2026-11-11',
        in_progress: [{ number: 1, title: 't', url: 'https://example.com' }],
      },
    ],
    ['an update with no run id', { event: 'update_pushed' }],
    [
      'an update with a run id of zero',
      { event: 'update_pushed', run_id: '0' },
    ],
  ])('refuses %s with 400', async (_name, body) => {
    await send(body).expect(400);
    expect(messageRepo.insertIdempotent).not.toHaveBeenCalled();
  });

  it('accepts each event with its own fields', async () => {
    await send({
      event: 'work_started',
      number: 12,
      title: 'Activity page',
      actor: 'Shawn',
      areas: ['chat'],
      also_in_area: [{ number: 9, title: 'Threads', actor: 'Winston' }],
    }).expect(200);
    await send({
      event: 'daily_summary',
      date: '2026-11-11',
      merged_total: 2,
      merged_by: [{ actor: 'Evan', count: 2 }],
    }).expect(200);
    await send({
      event: 'update_pushed',
      run_id: '35722904165',
      ota_update: true,
    }).expect(200);
    expect(messageRepo.insertIdempotent).toHaveBeenCalledTimes(3);
  });
});
