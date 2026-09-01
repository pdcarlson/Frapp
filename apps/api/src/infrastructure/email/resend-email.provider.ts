import { Injectable, Logger } from '@nestjs/common';
import type {
  IEmailProvider,
  SendInviteEmailParams,
} from '../../domain/adapters/email.interface';

export interface ResendProviderOptions {
  apiKey: string;
  /** e.g. `"Frapp <invites@frapp.live>"`. Must be on a domain verified with Resend. */
  fromAddress: string;
}

const RESEND_API_URL = 'https://api.resend.com/emails';

function inviteEmailHtml(joinUrl: string, role: string): string {
  return (
    `<p>You've been invited to join a chapter on Frapp as <strong>${escapeHtml(role)}</strong>.</p>` +
    `<p><a href="${joinUrl}">Accept the invite</a></p>` +
    `<p>Or copy this link into your browser:<br>${joinUrl}</p>`
  );
}

function inviteEmailText(joinUrl: string, role: string): string {
  return `You've been invited to join a chapter on Frapp as ${role}.\n\nAccept the invite: ${joinUrl}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Invite email transport over the Resend REST API using the global `fetch`
 * (Node 18+) rather than the `resend` SDK — same posture as
 * `PosthogAnalyticsProvider`: one endpoint, no client library needed.
 *
 * `sendInviteEmail` is best-effort per address: failures are logged and
 * swallowed into a `false` return so one bad address never fails a bulk send.
 * The recipient address is deliberately not included in warning logs.
 */
@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly apiKey: string;
  private readonly fromAddress: string;

  constructor(options: ResendProviderOptions) {
    this.apiKey = options.apiKey;
    this.fromAddress = options.fromAddress;
  }

  async sendInviteEmail(params: SendInviteEmailParams): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: params.to,
          subject: "You're invited to join a chapter on Frapp",
          html: inviteEmailHtml(params.joinUrl, params.role),
          text: inviteEmailText(params.joinUrl, params.role),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(
          `Resend invite email send returned ${response.status} ${response.statusText}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn('Resend invite email send failed', error as Error);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
