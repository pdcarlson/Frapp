import { Injectable, Logger } from '@nestjs/common';
import type {
  IEmailProvider,
  SendInviteEmailParams,
} from '../../domain/adapters/email.interface';

/**
 * Fallback email provider used when no `RESEND_API_KEY` is configured (e.g.
 * local dev, tests, CI). Logs at debug level instead of sending, and always
 * reports success so an unconfigured environment never fails an invite write
 * or misreports a partial-failure count for addresses nobody expects to
 * actually receive mail. Never throws.
 */
@Injectable()
export class NoopEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(NoopEmailProvider.name);

  sendInviteEmail(params: SendInviteEmailParams): Promise<boolean> {
    this.logger.debug(`email(noop) invite -> ${params.joinUrl}`);
    return Promise.resolve(true);
  }
}
