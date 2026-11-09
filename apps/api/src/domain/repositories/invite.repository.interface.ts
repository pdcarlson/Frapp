import { Invite } from '../entities/invite.entity';

export const INVITE_REPOSITORY = 'INVITE_REPOSITORY';

export interface IInviteRepository {
  findById(id: string): Promise<Invite | null>;
  findByToken(token: string): Promise<Invite | null>;
  findByChapter(chapterId: string): Promise<Invite[]>;
  /**
   * Invites emailed to `email` (matched case-insensitively, exactly) that are
   * still joinable at `now`: not used, not revoked, not expired. Newest first.
   * Every chapter's, so only ever called with the caller's own verified
   * address (`InviteService.findPendingForVerifiedEmail`).
   */
  findPendingByEmail(email: string, now: Date): Promise<Invite[]>;
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
