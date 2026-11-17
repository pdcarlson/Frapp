import { BadRequestException } from '@nestjs/common';
import { assertDashboardReturnUrl } from './dashboard-return-url';

describe('assertDashboardReturnUrl', () => {
  it('takes the deployment’s own dashboard origin, path and query kept', () => {
    const url = 'https://app.frapp.live/settings?tab=billing&checkout=success';
    expect(assertDashboardReturnUrl(url, 'success_url', 'production')).toBe(
      url,
    );
  });

  it.each([
    ['another site', 'https://example.com/settings', 'production'],
    [
      'the staging dashboard from production',
      'https://app.staging.frapp.live/settings',
      'production',
    ],
    [
      'a laptop from production',
      'http://localhost:3000/settings',
      'production',
    ],
    ['a look-alike host', 'https://app.frapp.live.example.com/', 'production'],
    ['not a URL', 'settings', 'staging'],
  ] as const)('refuses %s', (_label, url, env) => {
    expect(() => assertDashboardReturnUrl(url, 'return_url', env)).toThrow(
      BadRequestException,
    );
  });
});
