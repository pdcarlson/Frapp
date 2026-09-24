import {
  DEFAULT_UPDATE_URLS,
  resolveClientPolicy,
  validateClientPolicyEnv,
} from './client-policy.service';

describe('resolveClientPolicy', () => {
  it('requires nothing when no minimum is set', () => {
    expect(resolveClientPolicy('ios/0.0.1+1', {})).toEqual({
      updateRequired: false,
      updateUrl: DEFAULT_UPDATE_URLS.ios,
    });
  });

  it('requires an update below the platform minimum', () => {
    const env = { MOBILE_MIN_VERSION_IOS: '0.9.1' };
    expect(resolveClientPolicy('ios/0.9.0+40', env).updateRequired).toBe(true);
    expect(resolveClientPolicy('ios/0.9.1+1', env).updateRequired).toBe(false);
  });

  it('applies each platform its own minimum', () => {
    const env = {
      MOBILE_MIN_VERSION_IOS: '0.9.1',
      MOBILE_MIN_VERSION_ANDROID: '0.9.0+14',
    };
    expect(resolveClientPolicy('android/0.9.0+14', env).updateRequired).toBe(
      false,
    );
    expect(resolveClientPolicy('android/0.9.0+13', env).updateRequired).toBe(
      true,
    );
    expect(resolveClientPolicy('ios/0.9.0+99', env).updateRequired).toBe(true);
  });

  it('answers with the platform store listing by default', () => {
    expect(resolveClientPolicy('android/0.9.0+1', {}).updateUrl).toBe(
      DEFAULT_UPDATE_URLS.android,
    );
  });

  it('answers with a configured link instead, per platform', () => {
    const env = {
      MOBILE_UPDATE_URL_IOS: ' https://testflight.apple.com/join/abc123 ',
    };
    expect(resolveClientPolicy('ios/0.9.0', env).updateUrl).toBe(
      'https://testflight.apple.com/join/abc123',
    );
    expect(resolveClientPolicy('android/0.9.0', env).updateUrl).toBe(
      DEFAULT_UPDATE_URLS.android,
    );
  });

  // Boot validation refuses both, so these can only arrive by a path around it
  // (a test harness, a future caller). The policy must still fail open.
  it('treats a malformed minimum as none, and a non-https link as unset', () => {
    const env = {
      MOBILE_MIN_VERSION_IOS: 'latest',
      MOBILE_UPDATE_URL_IOS: 'https:testflight.apple.com/join/abc123',
    };
    expect(resolveClientPolicy('ios/0.0.1', env)).toEqual({
      updateRequired: false,
      updateUrl: DEFAULT_UPDATE_URLS.ios,
    });
  });

  it.each([
    [undefined],
    [''],
    ['web/1.0.0'],
    ['ios/latest'],
    [['ios/0.1.0', 'ios/0.1.0']],
  ])('fails open with no link for an unreadable header (%j)', (header) => {
    expect(
      resolveClientPolicy(header, { MOBILE_MIN_VERSION_IOS: '99.0.0' }),
    ).toEqual({ updateRequired: false, updateUrl: null });
  });
});

describe('validateClientPolicyEnv', () => {
  it('passes an empty environment', () => {
    expect(validateClientPolicyEnv({})).toEqual([]);
  });

  // WHATWG URL parsing fills in the missing `//` for special schemes, so this
  // parses as https. The app keeps only a literal `https://` link, so the
  // server has to refuse it rather than serve a link the app will drop.
  it('refuses an https link without its slashes', () => {
    expect(
      validateClientPolicyEnv({
        MOBILE_UPDATE_URL_IOS: 'https:testflight.apple.com/join/abc123',
      }),
    ).toEqual([expect.stringContaining('MOBILE_UPDATE_URL_IOS')]);
  });

  it('reports each bad value once', () => {
    expect(
      validateClientPolicyEnv({
        MOBILE_MIN_VERSION_IOS: '1.0.0.0',
        MOBILE_MIN_VERSION_ANDROID: '1.0.0',
        MOBILE_UPDATE_URL_IOS: 'not a url',
        MOBILE_UPDATE_URL_ANDROID:
          'https://play.google.com/store/apps/details?id=live.frapp.mobile',
      }),
    ).toEqual([
      expect.stringContaining('MOBILE_MIN_VERSION_IOS'),
      expect.stringContaining('MOBILE_UPDATE_URL_IOS'),
    ]);
  });
});
