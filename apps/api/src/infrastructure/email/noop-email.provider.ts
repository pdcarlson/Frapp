import { Injectable, Logger } from '@nestjs/common';
import type {
  IEmailProvider,
  SendInviteEmailParams,
} from '#domain/adapters/email.interface';

/**
 * Fallback email provider used when no `RESEND_API_KEY` is configured.
 *
 * Local/CI/staging-without-a-key: reports success so an unconfigured
 * environment never fails an invite write or misreports a partial-failure
 * count for addresses nobody expects to actually receive mail.
 *
 * Production (production Supabase, still no key): reports failure so the
 * wizard cannot print “Sent N invites” when nothing was delivered. Tokens
 * are still created; copy-link remains the working path (#1889). Never throws.
 */
@Injectable()
export class NoopEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(NoopEmailProvider.name);

  constructor(private readonly reportDeliveryFailure = false) {}

  sendInviteEmail(params: SendInviteEmailParams): Promise<boolean> {
    this.logger.debug(
      `email(noop${this.reportDeliveryFailure ? ',undelivered' : ''}) invite -> ${params.joinUrl}`,
    );
    return Promise.resolve(!this.reportDeliveryFailure);
  }
}
