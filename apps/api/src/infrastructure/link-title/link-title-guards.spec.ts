import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchableUrl, isPublicAddress } from './link-title-guards';

describe('link title guards (#4187)', () => {
  describe('the sign-up list (#4215)', () => {
    // The shared fixtures, through the API's real allowlist: the database
    // gathers a URL exactly when its title read may open it.
    const { fixtures } = JSON.parse(
      readFileSync(
        join(
          __dirname,
          '../../../../../packages/validation/sign-up-link-fixtures.json',
        ),
        'utf8',
      ),
    ) as { fixtures: { url: string; kind: string | null }[] };

    it.each(fixtures.map((f) => [f.url, f.kind !== null] as const))(
      '%s is fetchable: %s',
      (url, fetchable) => {
        expect(fetchableUrl(url) !== null).toBe(fetchable);
      },
    );
  });

  describe('fetchableUrl', () => {
    it('keeps an https sign-up link and drops its fragment', () => {
      expect(fetchableUrl('https://forms.gle/abc#x')?.href).toBe(
        'https://forms.gle/abc',
      );
    });

    it('upgrades http to https on the same host', () => {
      expect(fetchableUrl('http://www.calendly.com/olive')?.href).toBe(
        'https://www.calendly.com/olive',
      );
    });

    it.each([
      ['a user name in the authority', 'https://calendly.com:1@evil.example/'],
      ['credentials', 'https://user:pass@calendly.com/olive'],
      ['a non-default port', 'https://calendly.com:8443/olive'],
      ['an http link on port 443', 'http://calendly.com:443/olive'],
      ['an IPv4 literal', 'https://127.0.0.1/forms/'],
      ['an IPv6 literal', 'https://[::1]/forms/'],
      ['another scheme', 'ftp://forms.gle/abc'],
      ['a javascript URL', 'javascript:alert(1)'],
      ['a host off the list', 'https://example.com/forms/d/abc'],
      ['a trailing-dot host', 'https://calendly.com./olive'],
      ['garbage', 'not a url'],
    ])('refuses %s', (_name, raw) => {
      expect(fetchableUrl(raw)).toBeNull();
    });

    it('resolves a relative redirect against the page it came from', () => {
      const base = new URL('https://docs.google.com/forms/d/e/abc/viewform');
      expect(fetchableUrl('/forms/d/e/abc/viewform?usp=x', base)?.href).toBe(
        'https://docs.google.com/forms/d/e/abc/viewform?usp=x',
      );
    });

    it('refuses a redirect off the list, as Google’s sign-in for a private file is', () => {
      const base = new URL('https://docs.google.com/spreadsheets/d/abc/edit');
      expect(
        fetchableUrl(
          'https://accounts.google.com/ServiceLogin?continue=https://docs.google.com/spreadsheets/d/abc/edit',
          base,
        ),
      ).toBeNull();
    });
  });

  describe('isPublicAddress', () => {
    it.each([
      '142.250.80.46',
      '104.18.12.1',
      '2607:f8b0:4004:c1b::64',
      '2a00:1450:4001:80f::200e',
    ])('allows the public address %s', (address) => {
      expect(isPublicAddress(address)).toBe(true);
    });

    it.each([
      ['unspecified', '0.0.0.0'],
      ['private 10/8', '10.1.2.3'],
      ['private 172.16/12', '172.20.0.1'],
      ['private 192.168/16', '192.168.1.1'],
      ['CGNAT', '100.64.0.1'],
      ['loopback', '127.0.0.1'],
      ['loopback, high', '127.255.255.254'],
      ['link-local / cloud metadata', '169.254.169.254'],
      ['IETF assignments', '192.0.0.8'],
      ['documentation', '203.0.113.5'],
      ['benchmarking', '198.18.0.1'],
      ['multicast', '224.0.0.1'],
      ['broadcast', '255.255.255.255'],
      ['IPv6 loopback', '::1'],
      ['IPv6 unspecified', '::'],
      ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
      ['IPv4-mapped metadata', '::ffff:169.254.169.254'],
      ['NAT64', '64:ff9b::a9fe:a9fe'],
      ['unique-local', 'fd00::1'],
      ['link-local', 'fe80::1'],
      ['multicast', 'ff02::1'],
      ['Teredo', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
      ['6to4', '2002:7f00:1::1'],
      ['IPv6 documentation', '2001:db8::1'],
      ['not an address', 'localhost'],
    ])('refuses %s (%s)', (_name, address) => {
      expect(isPublicAddress(address)).toBe(false);
    });
  });
});
