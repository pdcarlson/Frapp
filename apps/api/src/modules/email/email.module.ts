import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isProductionSupabaseUrl } from '@repo/validation';
import {
  EMAIL_PROVIDER,
  type IEmailProvider,
} from '#domain/adapters/email.interface';
import { NoopEmailProvider } from '../../infrastructure/email/noop-email.provider';
import { ResendEmailProvider } from '../../infrastructure/email/resend-email.provider';

/** Log context for the provider-selection line emitted by {@link selectEmailProvider}. */
const EMAIL_PROVIDER_LOG_CONTEXT = 'EmailProvider';

/**
 * Used when `RESEND_FROM_EMAIL` is unset. Must be a local-part on a Resend-
 * verified sending domain (`mail.frapp.live`). The apex `invites@frapp.live`
 * is retired: Gmail trained it as spam on the first hosted Magic Link sends,
 * and Resend's guidance is not to send From the root domain.
 */
const DEFAULT_FROM_ADDRESS = 'Signet <invites@mail.frapp.live>';

/**
 * Choose the invite-email transport: Resend when an API key is configured,
 * otherwise the no-op provider — same posture as `selectAnalyticsProvider`,
 * so local dev, tests, and CI run without any email secret. On production
 * Supabase the no-op reports delivery failure (#1889).
 */
export function selectEmailProvider(config: ConfigService): IEmailProvider {
  const apiKey = config.get<string>('RESEND_API_KEY');

  if (!apiKey) {
    const production = isProductionSupabaseUrl(
      config.get<string>('SUPABASE_URL') ?? '',
    );
    if (production) {
      Logger.log(
        'RESEND_API_KEY not set — production invite emails report delivery failure (tokens still created).',
        EMAIL_PROVIDER_LOG_CONTEXT,
      );
      return new NoopEmailProvider(true);
    }
    Logger.log(
      'RESEND_API_KEY not set — invite emails use the no-op provider.',
      EMAIL_PROVIDER_LOG_CONTEXT,
    );
    return new NoopEmailProvider();
  }

  const fromAddress =
    config.get<string>('RESEND_FROM_EMAIL')?.trim() || DEFAULT_FROM_ADDRESS;
  Logger.log(
    `Invite emails will be sent via Resend from ${fromAddress}.`,
    EMAIL_PROVIDER_LOG_CONTEXT,
  );
  return new ResendEmailProvider({ apiKey, fromAddress });
}

@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: selectEmailProvider,
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
