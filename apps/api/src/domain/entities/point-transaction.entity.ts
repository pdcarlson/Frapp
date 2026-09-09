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
  /**
   * Origin chat channel for a chat-originated adjustment, written alongside
   * `client_message_id`. A replay re-attempts the points card only into this
   * channel — never into a different `channel_id` the request names — so a
   * lost best-effort post can be healed without re-broadcasting a FINE
   * (#1734). `null` for dashboard adjustments and for rows committed before
   * the column existed; those cannot be healed.
   */
  channel_id?: string | null;
  created_at: string;
}
