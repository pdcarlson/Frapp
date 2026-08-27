import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { createSupabaseMock } from './supabase-mock.factory';
import { configureApp } from '../../src/bootstrap';

export async function createTestApp(options?: {
  supabaseAuthUser?: { id: string; email?: string | null } | null;
  configureApp?: (app: INestApplication) => void;
}): Promise<{ app: INestApplication; module: TestingModule }> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider('SUPABASE_CLIENT')
    .useValue(
      createSupabaseMock({
        authUser: options?.supabaseAuthUser ?? null,
      }),
    )
    .compile();

  const app = moduleFixture.createNestApplication();
  configureApp(app);

  options?.configureApp?.(app);
  await app.init();

  return { app, module: moduleFixture };
}
