import { Injectable, Logger } from '@nestjs/common';
import type {
  IEmailProvider,
  SendInviteEmailParams,
} from '#domain/adapters/email.interface';
import { logThrowable } from '../observability/log-throwable';

export interface ResendProviderOptions {
  apiKey: string;
  /** e.g. `"Frapp <invites@mail.frapp.live>"`. Must be on a domain verified with Resend. */
  fromAddress: string;
}

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Names in an invite are typed by the inviter, and the email goes out from
 * Frapp's own address, so each is clipped: long enough for any real chapter
 * or person, too short to carry a paragraph of someone else's text.
 */
const MAX_NAME_IN_EMAIL = 60;

function clipName(value: string | null | undefined): string | null {
  const name = value?.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return name.length > MAX_NAME_IN_EMAIL
    ? `${name.slice(0, MAX_NAME_IN_EMAIL - 1).trimEnd()}…`
    : name;
}

/**
 * "You're invited to join Phi Gamma Delta Tau Nu on Frapp". The subject
 * leaves the inviter out: their display name is free text, and the subject
 * line is what a phishing attempt would borrow. Exported for its spec.
 */
export function inviteSubject(params: SendInviteEmailParams): string {
  return `You're invited to join ${clipName(params.chapterName) ?? 'a chapter'} on Frapp`;
}

/**
 * "Paul Carlson invited you to join Phi Gamma Delta Tau Nu on Frapp", with
 * either name left out when it is unknown. Exported for its spec.
 */
export function inviteHeadline(params: SendInviteEmailParams): string {
  const chapter = clipName(params.chapterName) ?? 'a chapter';
  const inviter = clipName(params.inviterName);
  return inviter
    ? `${inviter} invited you to join ${chapter} on Frapp`
    : `You're invited to join ${chapter} on Frapp`;
}

function inviteEmailHtml(params: SendInviteEmailParams): string {
  const { joinUrl, role } = params;
  return (
    `<p>${escapeHtml(inviteHeadline(params))}.</p>` +
    `<p>You'll join as <strong>${escapeHtml(role)}</strong>. The link works once and expires in 24 hours.</p>` +
    `<p><a href="${joinUrl}">Accept the invite</a></p>` +
    `<p>Or copy this link into your browser:<br>${joinUrl}</p>`
  );
}

function inviteEmailText(params: SendInviteEmailParams): string {
  const { joinUrl, role } = params;
  return `${inviteHeadline(params)}.\n\nYou'll join as ${role}. The link works once and expires in 24 hours.\n\nAccept the invite: ${joinUrl}`;
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
 * (Node 18+) rather than the `resend` SDK. PostHog product events now go
 * through `posthog-node` (lifecycle-safe batching); this path stays a
 * single fetch because one POST per invite is the whole contract.
 *
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
          subject: inviteSubject(params),
          html: inviteEmailHtml(params),
          text: inviteEmailText(params),
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
      logThrowable(
        this.logger,
        'warn',
        'Resend invite email send failed',
        error,
      );
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
