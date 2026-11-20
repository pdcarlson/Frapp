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
 * line is what a phishing attempt would borrow.
 */
function inviteSubject(params: SendInviteEmailParams): string {
  return `You're invited to join ${clipName(params.chapterName) ?? 'a chapter'} on Frapp`;
}

/**
 * "Paul Carlson invited you to join on Frapp as Pledge." The chapter is the
 * heading above it, so the line names who sent it, the product and the role,
 * leaving out the sender when unknown and the role for the Everyone role,
 * which is not a role at all. Both bodies carry it, so even the plain-text
 * part says what the invite is for (ADR-25).
 */
function inviteLine(params: SendInviteEmailParams): string {
  const inviter = clipName(params.inviterName);
  const role = clipName(params.role);
  const who = inviter
    ? `${inviter} invited you to join`
    : "You've been invited to join";
  return role ? `${who} on Frapp as ${role}.` : `${who} on Frapp.`;
}

/** "The invite works once, for 7 days. If you weren't expecting it, …" */
function inviteFootnote(params: SendInviteEmailParams): string {
  const days = params.validDays === 1 ? '1 day' : `${params.validDays} days`;
  return `The invite works once, for ${days}. If you weren't expecting it, you can ignore this email.`;
}

/**
 * Chapter first, one button, and no raw link: the link is the button's, so
 * the body has nothing to copy by mistake and nothing to mistake for the
 * button (#5628). The plain-text part, for mail clients that show no HTML,
 * has to carry the link itself. Inline styles only, as mail clients drop
 * `<style>`.
 */
function inviteEmailHtml(params: SendInviteEmailParams): string {
  const chapter = clipName(params.chapterName) ?? 'Your chapter';
  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px 16px;color:#1b1a22;line-height:1.5">` +
    `<p style="margin:0 0 4px;font-size:13px;color:#5d5a6b">Frapp</p>` +
    `<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">${escapeHtml(chapter)}</h1>` +
    `<p style="margin:0 0 24px;font-size:16px">${escapeHtml(inviteLine(params))}</p>` +
    `<p style="margin:0 0 24px"><a href="${escapeHtml(params.joinUrl)}" style="display:inline-block;background:#1b1a22;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open the invite</a></p>` +
    `<p style="margin:0;font-size:13px;color:#5d5a6b">${escapeHtml(inviteFootnote(params))}</p>` +
    `</div>`
  );
}

function inviteEmailText(params: SendInviteEmailParams): string {
  const chapter = clipName(params.chapterName) ?? 'Your chapter';
  return `${chapter}\n\n${inviteLine(params)}\n\nOpen the invite: ${params.joinUrl}\n\n${inviteFootnote(params)}`;
}

/**
 * Resend's own words for a refused send (`{ name, message }`), for the log:
 * a bare 403 doesn't say whether the key, the domain or the recipient was
 * refused (#2655). Addresses are masked, since a refusal can quote one, and
 * the text is clipped. Never throws.
 */
async function refusalReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      name?: unknown;
      message?: unknown;
    };
    const reason = [body.name, body.message]
      .filter((part): part is string => typeof part === 'string')
      .join(': ')
      .replace(/[^\s<>"']+@[^\s<>"']+/g, '<address>')
      .slice(0, 200);
    return reason ? ` (${reason})` : '';
  } catch {
    return '';
  }
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
          `Resend invite email send returned ${response.status} ${response.statusText}${await refusalReason(response)}`,
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
