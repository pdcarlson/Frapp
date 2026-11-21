import type { GifFavorite } from '#domain/entities';

export const GIF_FAVORITE_REPOSITORY = 'GIF_FAVORITE_REPOSITORY';

/** What a star writes: the row without its id, member and time. */
export type GifFavoriteInput = Omit<
  GifFavorite,
  'id' | 'user_id' | 'created_at'
>;

/**
 * A member's starred GIFs (#5772). Every call filters on the member: the
 * table has RLS on and no policies, so this is the only way in.
 */
export interface IGifFavoriteRepository {
  /**
   * The member's favorites from one provider, newest first. Scoped to the
   * provider so rows from one the server no longer uses neither show nor
   * count toward the cap.
   */
  listByUser(userId: string, provider: string): Promise<GifFavorite[]>;
  countByUser(userId: string, provider: string): Promise<number>;
  has(userId: string, provider: string, gifId: string): Promise<boolean>;
  /** Idempotent: starring a GIF already starred keeps the first row. */
  add(userId: string, input: GifFavoriteInput): Promise<void>;
  remove(userId: string, provider: string, gifId: string): Promise<void>;
}
