import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMAIL_PROVIDER,
  type IEmailProvider,
} from '#domain/adapters/email.interface';
import { NoopEmailProvider } from '../../infrastructure/email/noop-email.provider';
import { ResendEmailProvider } from '../../infrastructure/email/resend-email.provider';

/** Log context for the provider-selection line emitted by {@link selectEmailProvider}. */
const EMAIL_PROVIDER_LOG_CONTEXT = 'EmailProvider';

/** Used when `RESEND_FROM_EMAIL` is unset — a from-address on a domain Resend has not verified will bounce at send time, so this is a placeholder that makes the misconfiguration visible in the failure, not silent. */
const DEFAULT_FROM_ADDRESS = 'Frapp <invites@frapp.live>';

/**
 * Choose the invite-email transport: Resend when an API key is configured,
 * otherwise the no-op provider — same posture as `selectAnalyticsProvider`,
 * so local dev, tests, and CI run without any email secret.
 */
export function selectEmailProvider(config: ConfigService): IEmailProvider {
  const apiKey = config.get<string>('RESEND_API_KEY');

  if (!apiKey) {
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
