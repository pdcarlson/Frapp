-- Chat photos carry what a reader needs to draw them before the photo loads
-- (spec/behavior/chat/README.md § Photo previews).
--
-- `thumbhash`: a ThumbHash of the photo (https://evanw.github.io/thumbhash/),
-- base64. About 25 bytes, decoded on the reader's device into the blurred
-- placeholder the bubble shows while the preview downloads. Computed by the
-- sending client. Display only, so a wrong one costs a wrong blur.
--
-- `preview_storage_path`: a smaller JPEG copy of the photo the sender uploaded
-- next to the original, at `<original folder>/preview/preview.jpg`. The API
-- minted that path with the original's upload URL and refuses any other, so a
-- preview belongs to exactly one original and is deleted with it. Readers draw
-- the preview in the timeline and open the original full screen.
--
-- `width` and `height` already exist (the Discord importer fills them); chat
-- sends now fill them too, so a bubble keeps its shape while the photo loads.
--
-- Both additive and nullable: rows sent before this, and files that are not
-- photos, have neither. No backfill, no lock beyond the catalog update.
alter table public.chat_message_attachments
  add column if not exists thumbhash text,
  add column if not exists preview_storage_path text;

-- A ThumbHash is at most 25 bytes, 36 base64 characters. The cap leaves room
-- and stops the column becoming a place to park arbitrary client text.
alter table public.chat_message_attachments
  drop constraint if exists chat_message_attachments_thumbhash_len;
alter table public.chat_message_attachments
  add constraint chat_message_attachments_thumbhash_len
    check (thumbhash is null or char_length(thumbhash) <= 64);
