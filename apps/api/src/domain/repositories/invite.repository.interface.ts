import { Invite } from '../entities/invite.entity';

export const INVITE_REPOSITORY = 'INVITE_REPOSITORY';

export interface IInviteRepository {
  findById(id: string): Promise<Invite | null>;
  findByToken(token: string): Promise<Invite | null>;
  findByChapter(chapterId: string): Promise<Invite[]>;
  create(data: Partial<Invite>): Promise<Invite>;
  createMany(data: Partial<Invite>[]): Promise<Invite[]>;
  markUsed(id: string): Promise<void>;
  /**
   * Conditional claim: set `used_at` only when it is still null. Returns the
   * timestamp written, or `null` if another writer already claimed the row.
   */
  markUsedAtomically(id: string): Promise<string | null>;
  /**
   * Inverse of {@link markUsedAtomically}: clear `used_at` only when it still
   * equals `claimedAt` (this redeem's claim). Used when membership insert
   * fails after the claim so the token is not burned (#1863). A concurrent
   * `markUsed` (revoke) overwrites the timestamp and is left intact. Callers
   * must not invoke this when a membership row already exists for the
   * redeeming user — that path is a committed insert whose HTTP response
   * dropped, and releasing would reopen the token. Returns whether a row
   * was released.
   */
  releaseClaim(id: string, claimedAt: string): Promise<boolean>;
}
