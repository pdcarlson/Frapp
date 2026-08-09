export type ServiceEntryStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * One row of the chapter-wide service leaderboard, as returned by the
 * `get_service_leaderboard` RPC. Covers APPROVED entries only — the spec ranks
 * "total approved hours", so pending and rejected time never appears.
 *
 * `total_minutes` is the raw stored unit; hours are a presentation concern and
 * are derived by clients rather than rounded here, so no precision is lost on
 * the way out.
 */
export interface ServiceLeaderboardRow {
  user_id: string;
  member_name: string;
  /** `bigint` in SQL; PostgREST serializes it as a JSON number. */
  total_minutes: number;
  /** `bigint` in SQL; PostgREST serializes it as a JSON number. */
  entry_count: number;
}

/** Optional filters for the admin service-entry queue. */
export interface ServiceEntryFilters {
  status?: ServiceEntryStatus;
  /** Inclusive lower bound on `date` (YYYY-MM-DD). */
  startDate?: string;
  /** Inclusive upper bound on `date` (YYYY-MM-DD). */
  endDate?: string;
  userId?: string;
}

export interface ServiceEntry {
  id: string;
  chapter_id: string;
  user_id: string;
  date: string;
  duration_minutes: number;
  description: string;
  proof_path: string | null;
  status: ServiceEntryStatus;
  reviewed_by: string | null;
  review_comment: string | null;
  points_awarded: boolean;
  created_at: string;
}
