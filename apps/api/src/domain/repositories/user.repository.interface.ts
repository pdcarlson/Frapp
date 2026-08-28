import { User, UserDisplayIdentity } from '../entities/user.entity';

export const USER_REPOSITORY = 'USER_REPOSITORY';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByIds(ids: string[]): Promise<User[]>;
  /**
   * Narrow display projection — `id, display_name, avatar_url` only, chunked at
   * `ID_CHUNK_SIZE` so a large chapter cannot 414 the request line.
   *
   * Kept separate from {@link findByIds} on purpose rather than narrowing it:
   * that one selects `'*'` and six services depend on the full row, while the
   * chat display path must not marshal `email`/`bio`/`graduation_year` toward a
   * client (#1000). Two methods, two intents.
   */
  findDisplayIdentitiesByIds(ids: string[]): Promise<UserDisplayIdentity[]>;
  findBySupabaseAuthId(authId: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: Partial<User>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<User>;
  /**
   * Atomically tombstone the user via the `anonymize_user` RPC: scrub PII in
   * place, purge current-state rows (memberships, settings, tokens,
   * notifications, read receipts, study sessions), and — on the first
   * successful scrub only — rewrite display-name snapshots in
   * task/points/event chat cards (payload keys and generated content).
   * Deliberately NOT a no-op on a tombstone: every call re-runs the full
   * users-row scrub so PII written back during the deletion retry window is
   * re-scrubbed (do not add a deleted_at short-circuit — that reopens the
   * hole). Retries are cheap: only the card rewrite is first-run-gated —
   * pass `rescanCards` to force it (the post-auth-deletion convergence call
   * does, repairing cards that raced the first scrub).
   * Returns null when the user does not exist.
   */
  anonymize(id: string, rescanCards?: boolean): Promise<User | null>;
}
