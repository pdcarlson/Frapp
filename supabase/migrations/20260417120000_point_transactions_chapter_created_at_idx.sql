-- Supports chapter audit lists: filter by chapter_id, order by created_at desc, limit.
create index if not exists idx_point_transactions_chapter_created_at
  on point_transactions (chapter_id, created_at desc);
