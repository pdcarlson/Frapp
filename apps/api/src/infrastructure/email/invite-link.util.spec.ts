import type { ConfigService } from '@nestjs/config';
import { resolveAppOrigin, buildJoinUrl } from './invite-link.util';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

describe('resolveAppOrigin', () => {
  it('uses APP_URL when configured, stripping a trailing slash', () => {
    expect(
      resolveAppOrigin(
        makeConfig({ APP_URL: 'https://app.staging.frapp.live/' }),
      ),
    ).toBe('https://app.staging.frapp.live');
  });

  it('falls back to the production origin when unset', () => {
    expect(resolveAppOrigin(makeConfig({}))).toBe('https://app.frapp.live');
  });

  it('falls back to the production origin when blank', () => {
    expect(resolveAppOrigin(makeConfig({ APP_URL: '   ' }))).toBe(
      'https://app.frapp.live',
    );
  });
});

describe('buildJoinUrl', () => {
  it('builds a join URL with the token URL-encoded', () => {
    expect(buildJoinUrl('abc def', 'https://app.frapp.live')).toBe(
      'https://app.frapp.live/join?token=abc%20def',
    );
  });
});
