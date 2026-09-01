import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { selectEmailProvider } from './email.module';
import { NoopEmailProvider } from '../../infrastructure/email/noop-email.provider';
import { ResendEmailProvider } from '../../infrastructure/email/resend-email.provider';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

describe('selectEmailProvider', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('selects the no-op provider when RESEND_API_KEY is unset', () => {
    const provider = selectEmailProvider(makeConfig({}));

    expect(provider).toBeInstanceOf(NoopEmailProvider);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('RESEND_API_KEY not set'),
      'EmailProvider',
    );
  });

  it('selects Resend and names the default from-address when a key is set', () => {
    const provider = selectEmailProvider(
      makeConfig({ RESEND_API_KEY: 're_test' }),
    );

    expect(provider).toBeInstanceOf(ResendEmailProvider);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Frapp <invites@frapp.live>'),
      'EmailProvider',
    );
  });

  it('names a RESEND_FROM_EMAIL override in the log line', () => {
    selectEmailProvider(
      makeConfig({
        RESEND_API_KEY: 're_test',
        RESEND_FROM_EMAIL: 'Chapter <hello@example.com>',
      }),
    );

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Chapter <hello@example.com>'),
      'EmailProvider',
    );
  });
});
