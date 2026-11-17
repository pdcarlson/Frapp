import { ThrottlerModule, getOptionsToken } from '@nestjs/throttler';
import { MODULE_METADATA } from '@nestjs/common/constants';
import type { DynamicModule, Provider } from '@nestjs/common';

jest.mock('./infrastructure/analytics/posthog-runtime', () => ({
  enqueueSanitizedLog: jest.fn(),
  captureSentryErrorCorrelated: jest.fn(),
}));

/**
 * The throttlers `AppModule` registers, read from its own metadata, so these
 * fail when an entry is removed or its numbers change. The guard's tests run
 * against throttler lists they build themselves; only this one sees the app's.
 */
describe('AppModule throttlers', () => {
  // `AppModule` checks the environment as it is imported; the same
  // placeholders the API-contract check uses
  // (`scripts/check-api-contract-drift.mjs`) get it past that, and nothing here
  // starts the app.
  const placeholders: Record<string, string> = {
    SUPABASE_URL: 'https://placeholder.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'placeholder_value',
    STRIPE_SECRET_KEY: 'placeholder_value',
    STRIPE_WEBHOOK_SECRET: 'placeholder_value',
    STRIPE_PRICE_ID: 'placeholder_value',
  };
  const saved: Record<string, string | undefined> = {};
  let AppModule: unknown;

  beforeAll(() => {
    for (const [name, value] of Object.entries(placeholders)) {
      saved[name] = process.env[name];
      process.env[name] ??= value;
    }
    ({ AppModule } = jest.requireActual<{ AppModule: unknown }>(
      './app.module',
    ));
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const registered = (): Array<Record<string, unknown>> => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule as object,
    ) as unknown[] | undefined;
    const throttler = (imports ?? []).find(
      (entry): entry is DynamicModule =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as DynamicModule).module === ThrottlerModule,
    );
    const options = (throttler?.providers ?? []).find(
      (provider: Provider) =>
        typeof provider === 'object' &&
        'provide' in provider &&
        provider.provide === getOptionsToken(),
    ) as { useValue?: unknown } | undefined;
    return options?.useValue as Array<Record<string, unknown>>;
  };

  it('registers the read, write and unverified-token buckets with their limits', () => {
    expect(registered()).toEqual([
      { name: 'read', ttl: 60_000, limit: 100 },
      { name: 'write', ttl: 60_000, limit: 30 },
      // Literal numbers on purpose: a change to the shared ceiling is a
      // decision, and this is where it shows up in review.
      { name: 'unverified', ttl: 60_000, limit: 200 },
    ]);
  });
});
