import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { selectAnalyticsProvider } from './analytics.module';
import { NoopAnalyticsProvider } from '../../infrastructure/analytics/noop-analytics.provider';
import { PosthogAnalyticsProvider } from '../../infrastructure/analytics/posthog-analytics.provider';
import { resetPosthogRuntimeForTests } from '../../infrastructure/analytics/posthog-runtime';

/** Minimal ConfigService stand-in: only `get` is exercised by the factory. */
function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('selectAnalyticsProvider', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger, 'warn').mockImplementation();
    log = jest.spyOn(Logger, 'log').mockImplementation();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await resetPosthogRuntimeForTests();
  });

  it('selects PostHog and names the resolved host when a key is set', () => {
    const provider = selectAnalyticsProvider(
      makeConfig({ POSTHOG_API_KEY: 'phc_test' }),
    );

    expect(provider).toBeInstanceOf(PosthogAnalyticsProvider);
    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('https://us.i.posthog.com'),
      'AnalyticsProvider',
    );
  });

  it('names a POSTHOG_HOST override in the log line', () => {
    selectAnalyticsProvider(
      makeConfig({
        POSTHOG_API_KEY: 'phc_test',
        POSTHOG_HOST: 'https://eu.i.posthog.com/',
      }),
    );

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('https://eu.i.posthog.com'),
      'AnalyticsProvider',
    );
  });

  // The regression this file exists for: a salt with no key is a deployed
  // environment keying events that are then dropped, and it used to be silent.
  it('warns when a salt is configured but no PostHog key is', () => {
    const provider = selectAnalyticsProvider(
      makeConfig({ ANALYTICS_HMAC_SALT: 'a'.repeat(64) }),
    );

    expect(provider).toBeInstanceOf(NoopAnalyticsProvider);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'ANALYTICS_HMAC_SALT is set but POSTHOG_API_KEY is not',
      ),
      'AnalyticsProvider',
    );
  });

  it('logs without warning when neither is set — the local/CI resting state', () => {
    const provider = selectAnalyticsProvider(makeConfig({}));

    expect(provider).toBeInstanceOf(NoopAnalyticsProvider);
    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('POSTHOG_API_KEY not set'),
      'AnalyticsProvider',
    );
  });

  it('no-ops on a blank key', () => {
    const provider = selectAnalyticsProvider(
      makeConfig({ POSTHOG_API_KEY: '   ' }),
    );
    expect(provider).toBeInstanceOf(NoopAnalyticsProvider);
  });

  it('no-ops on a malformed key and warns', () => {
    const provider = selectAnalyticsProvider(
      makeConfig({ POSTHOG_API_KEY: 'not-a-project-key' }),
    );
    expect(provider).toBeInstanceOf(NoopAnalyticsProvider);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('malformed_key'),
      'AnalyticsProvider',
    );
  });

  it('no-ops on a personal API key (phx_) rather than treating it as a project key', () => {
    const provider = selectAnalyticsProvider(
      makeConfig({ POSTHOG_API_KEY: 'phx_not_a_project_key' }),
    );
    expect(provider).toBeInstanceOf(NoopAnalyticsProvider);
  });

  it('no-ops on a malformed host', () => {
    const provider = selectAnalyticsProvider(
      makeConfig({
        POSTHOG_API_KEY: 'phc_test',
        POSTHOG_HOST: 'ftp://example.invalid',
      }),
    );
    expect(provider).toBeInstanceOf(NoopAnalyticsProvider);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('malformed_host'),
      'AnalyticsProvider',
    );
  });
});
