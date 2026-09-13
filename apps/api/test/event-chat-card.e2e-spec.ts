import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EventService } from '../src/application/services/event.service';
import { SupabaseAuthGuard } from '../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../src/interface/guards/permissions.guard';
import { createSupabaseMock } from './helpers/supabase-mock.factory';
import { configureApp } from '../src/bootstrap';
import {
  createGuardStubs,
  PermissionsGuardStub,
} from './helpers/guard-stubs.factory';

const V1 = '/v1';
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

const { AuthGuardStub, ChapterGuardStub } = createGuardStubs({
  authUserId: 'auth-admin-1',
  email: 'admin@example.com',
  appUserId: 'admin-1',
  roleIds: ['role-exec'],
  chapterId: 'chapter-1',
});

const createdEvent = {
  id: 'evt-1',
  chapter_id: 'chapter-1',
  name: 'Chapter Meeting',
  description: null,
  location: null,
  start_time: '2026-06-15T18:00:00.000Z',
  end_time: '2026-06-15T19:00:00.000Z',
  point_value: 10,
  is_mandatory: false,
  recurrence_rule: null,
  parent_event_id: null,
  required_role_ids: null,
  notes: null,
  check_in_zone: null,
  check_in_zone_name: null,
  created_at: '2026-05-31T00:00:00.000Z',
};

/**
 * Verifies the `/event` slash command's server entry point: the controller
 * forwards `channel_id` / `client_message_id` into `EventService.create` (which
 * posts the server-originated card), and the UUID fields are validated by the
 * global pipe. The card-posting + forgery-guard behaviour itself is unit-tested
 * in `event.service.spec.ts` / `chat.service.spec.ts`.
 */
describe('Event chat card — create endpoint wiring (e2e)', () => {
  let app: INestApplication;

  const eventServiceMock = {
    findByChapter: jest.fn(),
    findById: jest.fn(),
    create: jest.fn().mockResolvedValue(createdEvent),
    update: jest.fn(),
    delete: jest.fn(),
    generateIcs: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue(createSupabaseMock())
      .overrideProvider(EventService)
      .useValue(eventServiceMock)
      .overrideGuard(SupabaseAuthGuard)
      .useClass(AuthGuardStub)
      .overrideGuard(ChapterGuard)
      .useClass(ChapterGuardStub)
      .overrideGuard(PermissionsGuard)
      .useClass(PermissionsGuardStub)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(() => {
    eventServiceMock.create.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('forwards channel_id + client_message_id so the service can post the card', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/events`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        name: 'Chapter Meeting',
        start_time: createdEvent.start_time,
        end_time: createdEvent.end_time,
        channel_id: CHANNEL_ID,
        client_message_id: CLIENT_MESSAGE_ID,
      })
      .expect(201);

    expect(eventServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: 'chapter-1',
        created_by: 'admin-1',
        name: 'Chapter Meeting',
        channel_id: CHANNEL_ID,
        client_message_id: CLIENT_MESSAGE_ID,
      }),
    );
  });

  it('omits the chat fields for a dashboard create', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/events`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        name: 'Dashboard event',
        start_time: createdEvent.start_time,
        end_time: createdEvent.end_time,
      })
      .expect(201);

    expect(eventServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: undefined,
        client_message_id: undefined,
      }),
    );
  });

  it('rejects a non-UUID channel_id (400) without calling the service', async () => {
    await request(app.getHttpServer())
      .post(`${V1}/events`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        name: 'Bad channel',
        start_time: createdEvent.start_time,
        end_time: createdEvent.end_time,
        channel_id: 'not-a-uuid',
        client_message_id: CLIENT_MESSAGE_ID,
      })
      .expect(400);

    expect(eventServiceMock.create).not.toHaveBeenCalled();
  });

  // #1717: the flag is only useful if it survives the response pipeline. A
  // serializer or interceptor that dropped an undeclared property would leave
  // the client unable to distinguish a failed card from a posted one — silently,
  // and exactly as it behaved before this change.
  it('returns card_posted in the response body so the client can act on it', async () => {
    eventServiceMock.create.mockResolvedValueOnce({
      ...createdEvent,
      card_posted: false,
    });

    const res = await request(app.getHttpServer())
      .post(`${V1}/events`)
      .set('authorization', 'Bearer token')
      .set('x-chapter-id', 'chapter-1')
      .send({
        name: 'Chapter Meeting',
        start_time: createdEvent.start_time,
        end_time: createdEvent.end_time,
        channel_id: CHANNEL_ID,
        client_message_id: CLIENT_MESSAGE_ID,
      })
      .expect(201);

    expect(res.body.card_posted).toBe(false);
    expect(res.body.id).toBe('evt-1');
  });
});
