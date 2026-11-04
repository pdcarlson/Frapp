import {
  BadRequestException,
  Body,
  CallHandler,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  Logger,
  NestInterceptor,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IsOptional, IsString } from 'class-validator';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { configureApp } from '../../bootstrap';
import { AnalyticsService } from '../../application/services/analytics.service';
import {
  FeatureEvent,
  type FeatureEventInput,
} from '../decorators/feature-event.decorator';
import type { RequestContext } from '../types/request-context.types';
import { FeatureEventInterceptor } from './feature-event.interceptor';

jest.mock('../../infrastructure/analytics/posthog-runtime', () => ({
  enqueueSanitizedLog: jest.fn(),
  captureSentryErrorCorrelated: jest.fn(),
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHAPTER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CHAPTER_ID = '33333333-3333-4333-8333-333333333333';

/** The message of each logged line (a stack, when logged, is the second argument). */
function firstArgs(spy: jest.SpyInstance): unknown[] {
  return spy.mock.calls.map((call: unknown[]) => call[0]);
}

/** Stands in for ChapterGuard: the user, the verified chapter, its opt-out. */
@Injectable()
class FakeChapterGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestContext>();
    req.appUser = { id: USER_ID };
    req.chapterId = CHAPTER_ID;
    req.analyticsOptOut = req.headers['x-test-opted-out'] === 'yes';
    return true;
  }
}

/** Stands in for AuthSyncInterceptor: sets the user after global interceptors ran. */
@Injectable()
class LateUserInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getRequest<RequestContext>().appUser = {
      id: USER_ID,
    };
    return next.handle();
  }
}

class TaskBody {
  @IsOptional()
  @IsString()
  channel_id?: string;
}

@Controller('fe')
class FeatureEventTestController {
  @Post('task')
  @UseGuards(FakeChapterGuard)
  @FeatureEvent('task-created', ({ body }: FeatureEventInput<TaskBody>) => ({
    posted_to_chat: !!body.channel_id,
  }))
  createTask(@Body() body: TaskBody) {
    return { id: 't1', echo: !!body };
  }

  @Post('fails')
  @UseGuards(FakeChapterGuard)
  @FeatureEvent('task-created')
  fails() {
    throw new BadRequestException('nope');
  }

  @Post('skip')
  @UseGuards(FakeChapterGuard)
  @FeatureEvent(
    'message-sent',
    ({ result }: FeatureEventInput<unknown, { deduplicated: boolean }>) =>
      result.deduplicated ? null : { kind: 'text' },
  )
  skip() {
    return { deduplicated: true };
  }

  @Post('poll')
  @UseGuards(FakeChapterGuard)
  @FeatureEvent('message-sent', () => ({ kind: 'poll' }))
  @FeatureEvent('poll-created', () => ({ option_count: 3 }))
  @FeatureEvent('announcement-posted', () => null)
  poll() {
    return { ok: true };
  }

  @Post('no-chapter')
  @UseInterceptors(LateUserInterceptor)
  @FeatureEvent('task-created')
  noChapter() {
    return { ok: true };
  }

  @Post('own-chapter')
  @UseInterceptors(LateUserInterceptor)
  @FeatureEvent('invite-redeemed', undefined, {
    chapterId: ({
      result,
    }: FeatureEventInput<unknown, { chapter_id: string }>) => result.chapter_id,
  })
  ownChapter() {
    return { chapter_id: OTHER_CHAPTER_ID };
  }

  @Post('describer-throws')
  @UseGuards(FakeChapterGuard)
  @FeatureEvent('task-created', () => {
    throw new Error('describer bug');
  })
  describerThrows() {
    return { ok: true };
  }

  @Post('undeclared')
  @UseGuards(FakeChapterGuard)
  @FeatureEvent(
    'task-created',
    // @ts-expect-error `title` isn't in task-created's allowlist. The types
    // refuse it; what's under test here is the runtime drop behind them.
    () => ({ posted_to_chat: true, title: 'Clean the kitchen' }),
  )
  undeclared() {
    return { ok: true };
  }

  @Get('ics')
  @UseGuards(FakeChapterGuard)
  @FeatureEvent('event-calendar-downloaded')
  ics(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/calendar');
    res.send('BEGIN:VCALENDAR');
  }

  @Post('plain')
  @UseGuards(FakeChapterGuard)
  plain() {
    return { ok: true };
  }
}

describe('FeatureEventInterceptor (#593)', () => {
  let app: INestApplication;
  const track = jest.fn<Promise<void>, unknown[]>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FeatureEventTestController],
      providers: [
        { provide: AnalyticsService, useValue: { track } },
        { provide: APP_INTERCEPTOR, useClass: FeatureEventInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, 'local');
    await app.init();
  });

  beforeEach(() => {
    track.mockReset();
    track.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('sends the event after the handler succeeds, with feature, chapter, app and the carried opt-out', async () => {
    await request(server())
      .post('/v1/fe/task')
      .set('Origin', 'http://localhost:3000')
      .send({ channel_id: 'c1' })
      .expect(201);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('task-created', USER_ID, {
      chapterId: CHAPTER_ID,
      properties: { feature: 'tasks', posted_to_chat: true },
      app: 'web',
      chapterOptedOut: false,
    });
  });

  it('labels a native build mobile and passes an opted-out chapter through', async () => {
    await request(server())
      .post('/v1/fe/task')
      .set('X-Client-Version', 'android/0.9.0+2')
      .set('x-test-opted-out', 'yes')
      .send({})
      .expect(201);

    expect(track).toHaveBeenCalledWith(
      'task-created',
      USER_ID,
      expect.objectContaining({
        app: 'mobile',
        chapterOptedOut: true,
        properties: { feature: 'tasks', posted_to_chat: false },
      }),
    );
  });

  it('sends no app when the request names none it can place', async () => {
    await request(server()).post('/v1/fe/task').send({}).expect(201);
    expect(track.mock.calls[0][2]).toEqual(
      expect.objectContaining({ app: undefined }),
    );
  });

  it('records nothing when the handler fails', async () => {
    await request(server()).post('/v1/fe/fails').expect(400);
    expect(track).not.toHaveBeenCalled();
  });

  it('records nothing when the describer returns null', async () => {
    await request(server()).post('/v1/fe/skip').expect(201);
    expect(track).not.toHaveBeenCalled();
  });

  it('sends each applicable event when a handler carries several', async () => {
    await request(server()).post('/v1/fe/poll').expect(201);
    expect(
      track.mock.calls
        .map((call) => [
          call[0],
          (call[2] as { properties: unknown }).properties,
        ])
        .sort(),
    ).toEqual([
      ['message-sent', { feature: 'chat', kind: 'poll' }],
      ['poll-created', { feature: 'polls', option_count: 3 }],
    ]);
  });

  it('records nothing without a chapter, even with a user', async () => {
    await request(server()).post('/v1/fe/no-chapter').expect(201);
    expect(track).not.toHaveBeenCalled();
  });

  it("uses the decorator's chapter on a route without ChapterGuard, and reads its opt-out itself", async () => {
    await request(server()).post('/v1/fe/own-chapter').expect(201);
    expect(track).toHaveBeenCalledWith('invite-redeemed', USER_ID, {
      chapterId: OTHER_CHAPTER_ID,
      properties: { feature: 'members' },
      app: undefined,
      chapterOptedOut: undefined,
    });
  });

  it('keeps the response when the describer throws, and logs it', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await request(server()).post('/v1/fe/describer-throws').expect(201);
    expect(track).not.toHaveBeenCalled();
    expect(firstArgs(error)).toContainEqual(
      expect.stringContaining('could not be built: describer bug'),
    );
  });

  it('drops a property outside the allowlist and logs it', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await request(server()).post('/v1/fe/undeclared').expect(201);
    expect(track.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        properties: { feature: 'tasks', posted_to_chat: true },
      }),
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('dropped undeclared properties: title'),
    );
  });

  it("doesn't wait on track: a send that never settles leaves the response alone", async () => {
    track.mockReturnValue(new Promise<void>(() => undefined));
    await request(server()).post('/v1/fe/task').send({}).expect(201);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('logs a rejected send instead of failing the request', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    track.mockRejectedValue(new Error('content key'));
    await request(server()).post('/v1/fe/task').send({}).expect(201);
    await new Promise((resolve) => setImmediate(resolve));
    expect(firstArgs(error)).toContainEqual(
      expect.stringContaining('was rejected: content key'),
    );
  });

  it('sends the event for a handler that writes its own response (@Res)', async () => {
    await request(server()).get('/v1/fe/ics').expect(200);
    expect(track).toHaveBeenCalledWith(
      'event-calendar-downloaded',
      USER_ID,
      expect.objectContaining({ properties: { feature: 'events' } }),
    );
  });

  it('leaves an undecorated handler alone', async () => {
    await request(server()).post('/v1/fe/plain').expect(201);
    expect(track).not.toHaveBeenCalled();
  });
});
