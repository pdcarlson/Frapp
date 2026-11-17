export interface Invite {
  id: string;
  token: string;
  chapter_id: string;
  role: string;
  expires_at: string;
  created_by: string;
  used_at: string | null;
  created_at: string;
  /**
   * The address `POST /v1/invites/email` sent this invite to; null for a
   * share-link invite. Display only: redeem never matches it against the
   * redeemer's account email.
   */
  email: string | null;
  /**
   * When an officer revoked it. A revoke also sets `used_at`, so this is only
   * what tells a revoked invite from a redeemed one.
   */
  revoked_at: string | null;
  /**
   * When the email provider refused this invite's email. Such an invite
   * doesn't count toward the daily emailed-invite ceilings; its token still
   * works when shared by hand.
   */
  email_failed_at: string | null;
}
