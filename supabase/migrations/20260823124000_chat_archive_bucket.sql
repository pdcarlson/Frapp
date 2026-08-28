-- `chat-archive` storage bucket: media pulled out of a Discord export.
--
-- WHY NOT REUSE THE `chat` BUCKET
--
-- `chat` is a member-upload surface: 25MB cap (MAX_UPLOAD_BYTES in
-- `@repo/validation`, matched by the local config.toml cap) and the 13-type
-- `document` allowlist, both sized for someone attaching a PDF in a channel.
-- A Discord archive is neither shaped like that nor written by a member: the
-- exports carry video and audio, and Discord's own per-file ceiling on a boosted
-- server is 100MB, so the live-chat cap would silently drop the most valuable
-- attachments in the archive. Widening `chat` instead would raise the ceiling on
-- every member upload in the product to solve a one-off import, so the archive
-- gets its own bucket and its own numbers -- the same one-bucket-per-domain
-- layout the repo already uses (chat, backwork, branding, documents, profiles,
-- reports, service).
--
-- WRITE PATH: SERVER-SIDE, NOT A SIGNED UPLOAD URL
--
-- Nothing user-controlled is ever stored here. The importer fetches each Discord
-- CDN object itself and writes the bytes through `IStorageProvider.uploadFile`
-- on the service-role key -- the same helper the report renderer uses, and the
-- same `assertSafeObjectPath` chokepoint. That matters for the MIME list below:
-- a signed upload URL cannot pin a content type (the uploader sets its own on the
-- PUT), whereas a server-side upload passes the type it actually resolved. So
-- unlike the member-upload buckets, `allowed_mime_types` here is a second belt
-- rather than the only one.
--
-- Private with no storage RLS policies, matching every other bucket in the repo:
-- reads are API-issued signed download URLs, which do not consult RLS, and direct
-- client access stays denied by default.
--
-- Object layout:
--   chapters/{chapter_id}/chat-archive/{channel_id}/{message_id}/{basename}
--   chapters/{chapter_id}/chat-archive/authors/{author_external_id}/{basename}
--
-- SVG IS DELIBERATELY ABSENT. It is script-bearing markup served from the storage
-- origin, and it is blocked on every other upload surface in this repo; an archive
-- is not a reason to make an exception.
--
-- Guarded on storage.buckets existing: the PGlite harness
-- (scripts/check-pglite-migrations.mjs) replays every migration into bare
-- Postgres, which has no Supabase storage schema -- there the bucket is simply not
-- provisioned. The on-conflict UPDATE (not DO NOTHING) backfills the constraint
-- columns onto any pre-existing bucket row.
--
-- NOTE: `supabase/config.toml` [storage] file_size_limit is a GLOBAL cap on the
-- local stack and overrides the per-bucket column when it is lower; it is raised
-- to 100MB in the same change. The hosted projects have an equivalent
-- project-level setting that is dashboard-only -- see DB_PROMOTION_RUNBOOK.md.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
  values (
    'chat-archive',
    'chat-archive',
    false,
    array[
      -- images (incl. the formats Discord re-encodes to)
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff',
      'image/avif',
      'image/heic',
      -- video
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      -- audio (voice messages and clips)
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
      'audio/webm',
      'audio/mp4',
      'audio/flac',
      -- documents, matching the live `document` kind plus the plain-text formats
      -- a Discord channel routinely carries
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'text/plain',
      'text/csv',
      'text/markdown',
      'application/json',
      -- archives
      'application/zip',
      'application/gzip',
      'application/x-7z-compressed'
    ],
    -- 104857600 = 100MB = Discord's boosted-server per-file ceiling. Live chat's
    -- 25MB would drop real archive content on the floor.
    104857600
  )
  on conflict (id) do update set
    public = excluded.public,
    allowed_mime_types = excluded.allowed_mime_types,
    file_size_limit = excluded.file_size_limit;
end $$;
