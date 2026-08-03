import { User } from '../entities/user.entity';

export const USER_REPOSITORY = 'USER_REPOSITORY';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByIds(ids: string[]): Promise<User[]>;
  findBySupabaseAuthId(authId: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: Partial<User>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<User>;
  /**
   * Atomically tombstone the user via the `anonymize_user` RPC: scrub PII in
   * place, purge current-state rows (memberships, settings, tokens,
   * notifications, read receipts, study sessions), and rewrite display-name
   * snapshots in task/points chat cards. Idempotent — re-running on a
   * tombstone returns it unchanged. Returns null when the user does not exist.
   */
  anonymize(id: string): Promise<User | null>;
}
