export type PointCategory =
  'ATTENDANCE' | 'ACADEMIC' | 'SERVICE' | 'FINE' | 'MANUAL' | 'STUDY';

export interface PointTransaction {
  id: string;
  chapter_id: string;
  user_id: string;
  amount: number;
  category: PointCategory;
  description: string;
  metadata: Record<string, unknown>;
  /**
   * Client-minted idempotency key (UUIDv4) for chat-originated adjustments.
   * A replay carrying the same `(chapter_id, client_message_id)` returns the
   * original transaction rather than writing a second ledger row. `null` for
   * dashboard adjustments, which send no key and are not deduplicated.
   */
  client_message_id?: string | null;
  created_at: string;
}
