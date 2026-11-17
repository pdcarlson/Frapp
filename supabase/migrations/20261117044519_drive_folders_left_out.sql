-- Google Drive sync: count the folders a pass could not read (#5331,
-- spec/behavior/chapter-docs.md § Google Drive folder). A pass reads ten
-- folder levels and 300 folders; past either, the folders it leaves unread
-- are counted here so the Google Drive panel can say so instead of their
-- files going missing without a word.

alter table public.chapter_drive_connections
  add column if not exists folders_left_out integer not null default 0;
