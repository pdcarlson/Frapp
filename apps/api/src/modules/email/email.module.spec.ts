import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PRODUCTION_SUPABASE_PROJECT_REF } from '@repo/validation';
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

  it('selects the no-op provider when RESEND_API_KEY is unset', async () => {
    const provider = selectEmailProvider(makeConfig({}));

    expect(provider).toBeInstanceOf(NoopEmailProvider);
    await expect(
      provider.sendInviteEmail({
        to: 'a@example.com',
        joinUrl: 'https://app.frapp.live/join?token=t',
        role: 'Member',
      }),
    ).resolves.toBe(true);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('RESEND_API_KEY not set'),
      'EmailProvider',
    );
  });

  it('reports invite delivery failure when the no-op is selected on production Supabase', async () => {
    const provider = selectEmailProvider(
      makeConfig({
        SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
      }),
    );

    expect(provider).toBeInstanceOf(NoopEmailProvider);
    await expect(
      provider.sendInviteEmail({
        to: 'a@example.com',
        joinUrl: 'https://app.frapp.live/join?token=t',
        role: 'Member',
      }),
    ).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('report delivery failure'),
      'EmailProvider',
    );
  });

  it('keeps the success no-op on a non-production Supabase host', async () => {
    const provider = selectEmailProvider(
      makeConfig({
        SUPABASE_URL: 'https://hnoyzpidbmizhbqaiity.supabase.co',
      }),
    );

    await expect(
      provider.sendInviteEmail({
        to: 'a@example.com',
        joinUrl: 'https://app.staging.frapp.live/join?token=t',
        role: 'Member',
      }),
    ).resolves.toBe(true);
  });

  it('selects Resend and names the default from-address when a key is set', () => {
    const provider = selectEmailProvider(
      makeConfig({ RESEND_API_KEY: 're_test' }),
    );

    expect(provider).toBeInstanceOf(ResendEmailProvider);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Signet <invites@frapp.live>'),
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
