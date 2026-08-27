import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { createSupabaseMock } from './supabase-mock.factory';
import { configureApp } from '../../src/bootstrap';

/**
 * Boot an E2E app with a mocked Supabase client.
 *
 * **Currently unused** — every spec builds its own `TestingModule` because each
 * needs different provider and guard overrides, which this factory does not
 * expose. It is kept because the bootstrap half of the problem it was written
 * for is now solved properly: both this and every spec call `configureApp()`,
 * so none of them can drift from `main.ts` (#1020).
 *
 * If you extend it, take overrides as a parameter rather than reproducing the
 * module setup here — a second partial copy is what caused the drift in the
 * first place.
 */
export async function createTestApp(options?: {
  supabaseAuthUser?: { id: string; email?: string | null } | null;
  /** Extra wiring applied after the shared bootstrap, before `init()`. */
  extraSetup?: (app: INestApplication) => void;
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

  options?.extraSetup?.(app);
  await app.init();

  return { app, module: moduleFixture };
}
