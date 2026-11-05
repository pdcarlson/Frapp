import { PRODUCTION_APP_ORIGIN } from '@repo/validation';
import {
  CORS_ALLOWED_ORIGINS,
  DASHBOARD_DEV_ORIGIN,
  STAGING_APP_ORIGIN,
} from './cors.options';
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

  it.each([PRODUCTION_APP_ORIGIN, STAGING_APP_ORIGIN, DASHBOARD_DEV_ORIGIN])(
    'labels the dashboard origin %s web',
    (origin) => {
      expect(requestApp(req({ origin }))).toBe('web');
    },
  );

  it('labels every origin CORS admits, except Expo web, as web', () => {
    // The dashboard's origins and the CORS allowlist share their constants;
    // this catches an origin added to the allowlist and not to the label.
    const admitted = new Set(Object.values(CORS_ALLOWED_ORIGINS).flat());
    const unlabelled = [...admitted].filter(
      (origin) => requestApp(req({ origin })) !== 'web',
    );
    expect(unlabelled).toEqual(['http://localhost:3002']);
  });

  it.each([
    ['Expo web', { origin: 'http://localhost:3002' }],
    ['another origin', { origin: 'https://evil.example' }],
    ['a malformed client version', { 'x-client-version': 'web/1.0.0' }],
    ['no headers at all', {}],
  ])('labels %s with no app', (_label, headers) => {
    expect(requestApp(req(headers))).toBeUndefined();
  });
});
