import {
  CanActivate,
  Controller,
  Get,
  INestApplication,
  Injectable,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../src/bootstrap';
import { readOncePerRequest } from '../src/infrastructure/supabase/request-reads';

/**
 * `configureApp` binds the per-request read store (#3728): a request's guards
 * and a GET's handler share one read; a write's handler reads afresh; and no
 * request ever sees another's read. The unit specs cover the store; this one
 * proves the middleware and the sealing interceptor are wired where it counts.
 */
let reads = 0;
const readMembership = () =>
  readOncePerRequest('members:user-1:chapter-1', () => {
    reads += 1;
    return Promise.resolve({ id: 'member-1', role_ids: ['role-1'] });
  });

/** Stands in for `ChapterGuard`, which makes the first membership read. */
@Injectable()
class ReadingGuard implements CanActivate {
  async canActivate(): Promise<boolean> {
    await readMembership();
    return true;
  }
}

@Controller('reads-probe')
@UseGuards(ReadingGuard)
class ReadsProbeController {
  @Get()
  async get() {
    await readMembership();
    return { reads };
  }

  @Post()
  async post() {
    await readMembership();
    return { reads };
  }
}

@Module({ controllers: [ReadsProbeController], providers: [ReadingGuard] })
class ReadsProbeModule {}

describe('Per-request reads (e2e, #3728)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [ReadsProbeModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    reads = 0;
  });

  it('a GET’s handler reuses the read its guard made', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/reads-probe')
      .expect(200);
    expect(response.body).toEqual({ reads: 1 });
  });

  it('a POST’s handler reads again after its guard', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/reads-probe')
      .expect(201);
    expect(response.body).toEqual({ reads: 2 });
  });

  it('never carries a read from one request to the next', async () => {
    await request(app.getHttpServer()).get('/v1/reads-probe').expect(200);
    const response = await request(app.getHttpServer())
      .get('/v1/reads-probe')
      .expect(200);
    expect(response.body).toEqual({ reads: 2 });
  });
});
