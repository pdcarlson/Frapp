import { PRODUCTION_APP_ORIGIN } from '@repo/validation';
import { STAGING_APP_ORIGIN } from './cors.options';
import { requestApp } from './request-app';

function req(headers: Record<string, string | string[]>) {
  return { headers };
}

describe('requestApp (#593)', () => {
  it('labels a native build by its client-version header', () => {
    expect(requestApp(req({ 'x-client-version': 'ios/0.9.0+12' }))).toBe(
      'mobile',
    );
    expect(requestApp(req({ 'x-client-version': 'android/0.9.0' }))).toBe(
      'mobile',
    );
  });

  it('prefers the client-version header over an Origin', () => {
    expect(
      requestApp(
        req({
          'x-client-version': 'android/0.9.0+2',
          origin: PRODUCTION_APP_ORIGIN,
        }),
      ),
    ).toBe('mobile');
  });

  it.each([PRODUCTION_APP_ORIGIN, STAGING_APP_ORIGIN, 'http://localhost:3000'])(
    'labels the dashboard origin %s web',
    (origin) => {
      expect(requestApp(req({ origin }))).toBe('web');
    },
  );

  it.each([
    ['Expo web', { origin: 'http://localhost:3002' }],
    ['another origin', { origin: 'https://evil.example' }],
    ['a malformed client version', { 'x-client-version': 'web/1.0.0' }],
    ['no headers at all', {}],
  ])('labels %s with no app', (_label, headers) => {
    expect(requestApp(req(headers))).toBeUndefined();
  });
});
