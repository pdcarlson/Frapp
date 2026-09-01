export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

export interface SendInviteEmailParams {
  /** Recipient address. */
  to: string;
  /** Full `${origin}/join?token=…` URL the recipient redeems. */
  joinUrl: string;
  /** Role name the invite grants, shown in the email body. */
  role: string;
}

/**
 * Transport for transactional invite email. Delivery is best-effort per
 * address: implementations must never throw, and report success/failure via
 * the return value so a bulk send can report which addresses actually went
 * out without failing the whole batch.
 */
export interface IEmailProvider {
  sendInviteEmail(params: SendInviteEmailParams): Promise<boolean>;
}
