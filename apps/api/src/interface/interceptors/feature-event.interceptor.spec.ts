import {
  BadRequestException,
  Body,
  CallHandler,
  CanActivate,
  Controller,
  ExecutionContext,
  INestApplication,
  Injectable,
  Logger,
  NestInterceptor,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IsOptional, IsString } from 'class-validator';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as Sentry from '@sentry/nestjs';
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

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<typeof import('@sentry/nestjs')>('@sentry/nestjs'),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

const captureException = jest.mocked(Sentry.captureException);
const captureMessage = jest.mocked(Sentry.captureMessage);

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHAPTER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CHAPTER_ID = '33333333-3333-4333-8333-333333333333';

/** Set by the `slow` handler as it finishes; read by a `track` stub. */
let handlerFinished = false;

/** The message of each logged line (a stack, when logged, is the second argument). */
function firstArgs(spy: jest.SpyInstance): unknown[] {
  return spy.mock.calls.map((call: unknown[]) => call[0]);
}

/** Stands in for ChapterGuard: the user and the verified chapter. */
@Injectable()
class FakeChapterGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestContext>();
    req.appUser = { id: USER_ID };
    req.chapterId = CHAPTER_ID;
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

  @Post('slow')
  @UseGuards(FakeChapterGuard)
  @FeatureEvent('task-created')
  async slow() {
    handlerFinished = false;
    await new Promise((resolve) => setImmediate(resolve));
    handlerFinished = true;
    return { ok: true };
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

  // Never requested: the check under test is the compile. A describer typed
  // for a result the handler doesn't return is refused, so a change to a
  // handler's return breaks the build rather than the event.
  @Post('mistyped')
  // @ts-expect-error `{ deduplicated }` isn't what `mistyped` returns.
  @FeatureEvent(
    'message-sent',
    ({ result }: FeatureEventInput<unknown, { deduplicated: boolean }>) =>
      result.deduplicated ? null : { kind: 'text' },
  )
  mistyped() {
    return { ok: true };
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
    captureException.mockClear();
    captureMessage.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('sends the event after the handler succeeds, with feature, chapter and app', async () => {
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
    });
  });

  it('labels a native build mobile', async () => {
    await request(server())
      .post('/v1/fe/task')
      .set('X-Client-Version', 'android/0.9.0+2')
      .send({})
      .expect(201);

    expect(track).toHaveBeenCalledWith(
      'task-created',
      USER_ID,
      expect.objectContaining({
        app: 'mobile',
        appVersion: { version: '0.9.0', build: '2' },
        properties: { feature: 'tasks', posted_to_chat: false },
      }),
    );
  });

  it("calls track only after the handler's work is done, so track's opt-out read sees it", async () => {
    // The handler stands in for a request that opts the chapter out (or a
    // concurrent one that commits while it runs): `track` reads the flag when
    // it is called, so it must not be called before the handler finishes.
    let sawHandlerFinish: boolean | undefined;
    track.mockImplementation(() => {
      sawHandlerFinish = handlerFinished;
      return Promise.resolve();
    });
    await request(server()).post('/v1/fe/slow').expect(201);
    expect(sawHandlerFinish).toBe(true);
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

  it("uses the decorator's chapter on a route without ChapterGuard", async () => {
    await request(server()).post('/v1/fe/own-chapter').expect(201);
    expect(track).toHaveBeenCalledWith('invite-redeemed', USER_ID, {
      chapterId: OTHER_CHAPTER_ID,
      properties: { feature: 'members' },
      app: undefined,
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
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        level: 'error',
        fingerprint: ['caught-failure', 'feature-event-build-failed', 'Error'],
      }),
    );
  });

  it('drops a property outside the allowlist and warns about it', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await request(server()).post('/v1/fe/undeclared').expect(201);
    expect(track.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        properties: { feature: 'tasks', posted_to_chat: true },
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('dropped undeclared properties: title'),
    );
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        level: 'warning',
        fingerprint: [
          'caught-failure',
          'feature-event-undeclared-properties:task-created',
        ],
      }),
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
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        level: 'error',
        fingerprint: [
          'caught-failure',
          'feature-event-track-rejected',
          'Error',
        ],
      }),
    );
  });

  it('leaves an undecorated handler alone', async () => {
    await request(server()).post('/v1/fe/plain').expect(201);
    expect(track).not.toHaveBeenCalled();
  });
});
