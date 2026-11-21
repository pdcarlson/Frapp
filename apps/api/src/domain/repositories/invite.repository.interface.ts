import { Invite } from '../entities/invite.entity';

export const INVITE_REPOSITORY = 'INVITE_REPOSITORY';

export interface EmailedInviteBatch {
  chapterId: string;
  createdBy: string;
  invites: { token: string; role: string; expires_at: string; email: string }[];
  since: Date;
  chapterLimit: number;
  inviterLimit: number;
}

export type EmailedInviteOutcome =
  | { outcome: 'ok'; invites: Invite[] }
  /** When each counted invite was made, oldest first. */
  | { outcome: 'over'; chapter: string[]; inviter: string[] };

export interface IInviteRepository {
  findById(id: string): Promise<Invite | null>;
  findByToken(token: string): Promise<Invite | null>;
  findByChapter(chapterId: string): Promise<Invite[]>;
  /**
   * The chapter's links (#3353) that no officer has turned off, expired or
   * not, newest first. At most one per role since #5633:
   * `invites_one_chapter_link_per_role`.
   */
  findChapterLinks(chapterId: string): Promise<Invite[]>;
  /**
   * Invites emailed to `email` (matched case-insensitively, exactly) that are
   * still joinable at `now`: not used, not revoked, not expired. Newest first.
   * Every chapter's, so only ever called with the caller's own verified
   * address (`InviteService.findPendingForVerifiedEmail`).
   */
  findPendingByEmail(email: string, now: Date): Promise<Invite[]>;
  /**
   * Inserts emailed invites for one chapter and sender, all or none, only
   * when the batch fits under both daily ceilings
   * (`domain/constants/daily-send-limits.ts`): the chapter's emailed invites
   * made since `since`, and the sender's across every chapter, not counting
   * one whose send failed ({@link markEmailFailed}). The count and the insert
   * are one step, one writer per chapter and sender at a time
   * (`create_emailed_invites`). Otherwise nothing is inserted and the answer
   * carries when each counted invite was made, for the refusal's wait.
   */
  createEmailed(batch: EmailedInviteBatch): Promise<EmailedInviteOutcome>;
  /**
   * Marks invites of `chapterId` whose email the provider refused, so they
   * stop counting toward the daily ceilings. Their tokens stay valid.
   */
  markEmailFailed(chapterId: string, ids: string[]): Promise<void>;
  create(data: Partial<Invite>): Promise<Invite>;
  createMany(data: Partial<Invite>[]): Promise<Invite[]>;
  /**
   * Revoke: set `revoked_at` and `used_at` together, unless already revoked.
   * Overwriting `used_at` means a redeem that has claimed the row but not yet
   * inserted the membership can't reopen it with {@link releaseClaim}, so a
   * revoke always sticks (#1863).
   */
  markRevoked(id: string): Promise<void>;
  /**
   * Revoke each of `ids` that is still pending (`used_at` null). One redeemed
   * in the meantime stays Joined. For replacing an address's older invites
   * once a newer one has reached it.
   */
  revokePending(ids: string[]): Promise<void>;
  /**
   * Conditional claim: set `used_at` only when it is still null. Returns the
   * timestamp written, or `null` if another writer already claimed the row.
   */
  markUsedAtomically(id: string): Promise<string | null>;
  /**
   * Inverse of {@link markUsedAtomically}: clear `used_at` only when it still
   * equals `claimedAt` (this redeem's claim). Used when membership insert
   * fails after the claim so the token is not burned (#1863). A concurrent
   * `markRevoked` overwrites `used_at`, so it is never undone here. Callers
   * must not invoke this when a membership row already exists for the
   * redeeming user — that path is a committed insert whose HTTP response
   * dropped, and releasing would reopen the token. Returns whether a row
   * was released.
   */
  releaseClaim(id: string, claimedAt: string): Promise<boolean>;
}
