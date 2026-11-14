import {
  User,
  UserContact,
  UserDisplayIdentity,
  UserSharedBirthday,
} from '../entities/user.entity';

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
  /**
   * `id, display_name, email`, chunked like {@link findDisplayIdentitiesByIds}.
   * For officer exports (the roster report) that print an address; a separate
   * method so the display path above never gains `email`.
   */
  findContactsByIds(ids: string[]): Promise<UserContact[]>;
  /**
   * The birthdays of these users that are shared with their chapters
   * (`birthday_visibility = 'chapter'`, #4959), chunked like
   * {@link findDisplayIdentitiesByIds}. A user who keeps theirs to themselves,
   * or set none, is left out; the year is never read.
   */
  findSharedBirthdaysByIds(ids: string[]): Promise<UserSharedBirthday[]>;
  findBySupabaseAuthId(authId: string): Promise<User | null>;
  create(data: Partial<User>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<User>;
  /**
   * Sets `whats_new_seen_version` to `next` only while it still holds
   * `expected` (null for none) on a live row: a compare-and-set, so two
   * devices writing at once can't lower it (#4043). False when the row had
   * moved on, or is a tombstone.
   */
  compareAndSetWhatsNewSeen(
    id: string,
    expected: string | null,
    next: string,
  ): Promise<boolean>;
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
