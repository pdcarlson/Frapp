import { parsePosthogConfig, resolvePosthogHost } from './posthog-config';

describe('parsePosthogConfig', () => {
  it('accepts a project key and default host', () => {
    expect(parsePosthogConfig({ POSTHOG_API_KEY: 'phc_abc123' })).toEqual({
      reason: 'ok',
      config: {
        apiKey: 'phc_abc123',
        host: 'https://us.i.posthog.com',
      },
    });
  });

  it('reports missing vs empty vs malformed', () => {
    expect(parsePosthogConfig({})).toEqual({ config: null, reason: 'missing' });
    expect(parsePosthogConfig({ POSTHOG_API_KEY: '  ' })).toEqual({
      config: null,
      reason: 'empty',
    });
    expect(parsePosthogConfig({ POSTHOG_API_KEY: 'sk-not-posthog' })).toEqual({
      config: null,
      reason: 'malformed_key',
    });
    expect(parsePosthogConfig({ POSTHOG_API_KEY: 'phx_personal' })).toEqual({
      config: null,
      reason: 'malformed_key',
    });
  });

  it('rejects a non-http host that was explicitly set', () => {
    expect(
      parsePosthogConfig({
        POSTHOG_API_KEY: 'phc_abc123',
        POSTHOG_HOST: 'not a url',
      }),
    ).toEqual({ config: null, reason: 'malformed_host' });
  });

  it('treats a blank host as the US default', () => {
    expect(
      parsePosthogConfig({
        POSTHOG_API_KEY: 'phc_abc123',
        POSTHOG_HOST: '  ',
      }).config?.host,
    ).toBe('https://us.i.posthog.com');
  });
});

describe('resolvePosthogHost', () => {
  it('defaults to PostHog Cloud US', () => {
    expect(resolvePosthogHost(undefined)).toBe('https://us.i.posthog.com');
  });

  it('treats a blank value as unset', () => {
    expect(resolvePosthogHost('   ')).toBe('https://us.i.posthog.com');
  });

  it('strips a trailing slash', () => {
    expect(resolvePosthogHost('https://eu.i.posthog.com/')).toBe(
      'https://eu.i.posthog.com',
    );
  });
});
