import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLIENT_PLATFORMS,
  clientVersionForLog,
  isBelowMinimum,
  parseClientVersionHeader,
  parseVersionWithBuild,
} from './client-version';

describe('parseVersionWithBuild', () => {
  it('reads a version with and without a build number', () => {
    expect(parseVersionWithBuild('0.9.0')).toEqual({
      version: [0, 9, 0],
      build: null,
    });
    expect(parseVersionWithBuild('0.9.0+14')).toEqual({
      version: [0, 9, 0],
      build: 14,
    });
  });

  it('pads a short version with zeros', () => {
    expect(parseVersionWithBuild('1')).toEqual({
      version: [1, 0, 0],
      build: null,
    });
    expect(parseVersionWithBuild('1.2+3')).toEqual({
      version: [1, 2, 0],
      build: 3,
    });
  });

  it('ignores surrounding whitespace, as an env value may carry it', () => {
    expect(parseVersionWithBuild(' 0.9.1 ')?.version).toEqual([0, 9, 1]);
  });

  // Each of these is a typo an operator could make in a minimum. A lenient
  // parse would turn it into a different minimum than the one they meant.
  it.each([
    '',
    'v0.9.0',
    '0.9.0-beta.1',
    '0.9.0.1',
    '09.0.0',
    '0.9.0+',
    '0.9.0+01',
    '0.9.x',
    '0..9',
    '1234567890.0.0',
  ])('refuses %j', (raw) => {
    expect(parseVersionWithBuild(raw)).toBeNull();
  });
});

describe('parseClientVersionHeader', () => {
  it('reads both platforms', () => {
    expect(parseClientVersionHeader('ios/0.9.0+12')).toEqual({
      platform: 'ios',
      version: [0, 9, 0],
      build: 12,
    });
    expect(parseClientVersionHeader('android/1.2.3+7')).toEqual({
      platform: 'android',
      version: [1, 2, 3],
      build: 7,
    });
  });

  it('accepts a header without a build number', () => {
    expect(parseClientVersionHeader('ios/0.9.0')?.build).toBeNull();
  });

  it('treats the platform case-insensitively', () => {
    expect(parseClientVersionHeader('iOS/0.9.0')?.platform).toBe('ios');
  });

  it.each([
    [undefined],
    [''],
    ['0.9.0'],
    ['web/0.9.0'],
    ['ios/'],
    ['ios/latest'],
    [['ios/0.9.0', 'ios/0.9.1']],
    [`ios/0.9.0+${'1'.repeat(80)}`],
  ])('returns null for %j', (raw) => {
    expect(parseClientVersionHeader(raw)).toBeNull();
  });
});

describe('isBelowMinimum', () => {
  const v = (raw: string) => parseVersionWithBuild(raw)!;

  it('compares versions part by part, numerically', () => {
    expect(isBelowMinimum(v('0.9.0'), v('0.9.1'))).toBe(true);
    expect(isBelowMinimum(v('0.9.9'), v('0.10.0'))).toBe(true);
    expect(isBelowMinimum(v('0.10.0'), v('0.9.9'))).toBe(false);
    expect(isBelowMinimum(v('1.0.0'), v('0.99.99'))).toBe(false);
  });

  it('lets an equal version through when the minimum names no build', () => {
    expect(isBelowMinimum(v('0.9.0+3'), v('0.9.0'))).toBe(false);
  });

  it('compares builds on an equal version when the minimum names one', () => {
    expect(isBelowMinimum(v('0.9.0+13'), v('0.9.0+14'))).toBe(true);
    expect(isBelowMinimum(v('0.9.0+14'), v('0.9.0+14'))).toBe(false);
    expect(isBelowMinimum(v('0.9.0+15'), v('0.9.0+14'))).toBe(false);
  });

  it('ignores the build once the versions differ', () => {
    expect(isBelowMinimum(v('0.9.1+1'), v('0.9.0+14'))).toBe(false);
    expect(isBelowMinimum(v('0.8.9+99'), v('0.9.0+1'))).toBe(true);
  });

  it('fails open when the client reported no build and the minimum needs one', () => {
    expect(isBelowMinimum(v('0.9.0'), v('0.9.0+14'))).toBe(false);
  });
});

describe('clientVersionForLog', () => {
  it('writes back the parsed build, with and without a build number', () => {
    expect(clientVersionForLog('ios/0.9.0+12')).toBe('ios/0.9.0+12');
    expect(clientVersionForLog('android/1.2')).toBe('android/1.2.0');
    expect(clientVersionForLog(' Android/1.2.3 ')).toBe('android/1.2.3');
  });

  it('is absent when no header was sent', () => {
    expect(clientVersionForLog(undefined)).toBeUndefined();
  });

  // The log line is JSON, but the value is still caller-chosen text. Only the
  // parsed parts are ever written, so nothing the caller typed reaches it.
  it.each([
    ['a malformed version', 'ios/latest'],
    ['an unknown platform', 'windows/1.0.0'],
    ['a newline smuggled into the value', 'ios/1.0.0\n[Nest] forged line'],
    ['a repeated header', ['ios/1.0.0', 'ios/2.0.0']],
    ['an empty value', ''],
  ])('records %s as invalid, never the raw value', (_label, raw) => {
    expect(clientVersionForLog(raw)).toBe('invalid');
  });
});

// `expo.version` is what every native build reports in `X-Client-Version`
// (`apps/mobile/lib/client-version.ts`), and it is edited on every native
// change. A shape this parser refuses, such as a `-beta.1` tag, reads as no
// header, which the policy treats as supported. Android accepts any
// `versionName`, so that build would ship, and no minimum could ever retire it.
describe('the version the mobile app ships', () => {
  const appJson = JSON.parse(
    readFileSync(join(__dirname, '../../../../mobile/app.json'), 'utf8'),
  ) as { expo: { version: string } };

  it.each(CLIENT_PLATFORMS)('parses as the %s header', (platform) => {
    const expected = parseVersionWithBuild(appJson.expo.version);
    expect(expected).not.toBeNull();
    expect(
      parseClientVersionHeader(`${platform}/${appJson.expo.version}+1`),
    ).toEqual({ platform, version: expected?.version, build: 1 });
  });
});
