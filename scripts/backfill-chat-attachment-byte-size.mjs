#!/usr/bin/env node
//
// Backfills `chat_message_attachments.byte_size` for existing rows where it's
// still null (#1231).
//
// The `20260823121000` migration recovered `storage_path`/`filename` for
// legacy Discord-import attachments out of message prose, but explicitly left
// `byte_size` null -- its own comment: "not recoverable from the message
// body, only from a storage HEAD, which a migration must not do." This
// script is that HEAD, run once as a script for exactly that reason: a SQL
// migration cannot make an HTTP call.
//
// `width`/`height` are deliberately NOT backfilled here -- see the doc
// comment on `backfillByteSize` below.
//
// Idempotent and re-runnable: it only ever selects rows still missing
// `byte_size`, so a partial run (rate limit, a transient storage error) can
// simply be re-run and picks up exactly the rows still unset.
//
// Env inputs:
//   SUPABASE_URL               required, e.g. https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  required, bypasses RLS -- never log it
//
// Usage:
//   node scripts/backfill-chat-attachment-byte-size.mjs [--dry-run]

import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./ci/lib/env.mjs";

/**
 * Comfortably above any realistic attachment count from a single Discord
 * archive import (the only source of legacy null-byte_size rows). Fetched in
 * one query rather than paginated, on purpose: a paginated loop that re-runs
 * the same `.is("byte_size", null)` filter would silently skip rows once
 * earlier ones in the batch succeed and drop out of that filter out from
 * under a numeric offset. If a chapter genuinely has more than this many
 * unbackfilled rows, this script's own re-runnable contract is the answer --
 * run it again and the remainder is picked up, reported via the summary line.
 */
const MAX_ROWS = 20_000;

/**
 * Splits a bucket-relative object path into its parent folder and basename,
 * matching the layout `IStorageProvider.listFiles`/`.list()` expect (a
 * folder prefix, not the full object path).
 */
function splitPath(storagePath) {
  const at = storagePath.lastIndexOf("/");
  if (at < 0) return { folder: "", basename: storagePath };
  return { folder: storagePath.slice(0, at), basename: storagePath.slice(at + 1) };
}

/**
 * `width`/`height` are deliberately NOT backfilled by this script, even
 * though `#1231`'s acceptance criteria mentions them "where cheaply
 * available."
 *
 * Nothing in this codebase extracts image dimensions anywhere today: the live
 * upload path (`apps/web/components/chat/composer.tsx`) sends only
 * `file.size`; `MessageAttachmentDto` has no width/height fields; the Discord
 * importer never sets them either (confirmed by reading all three before
 * writing this script). Populating them here would mean introducing a new
 * image-decoding dependency (`sharp`, `probe-image-size`, ...) as a side
 * effect of a one-off backfill -- a real, separate infrastructure decision
 * (a native binary, a build-image size/time cost) that this task should not
 * make unilaterally. That decision is filed as #1505 for whoever picks it up;
 * this script closes the `byte_size` half of the acceptance criteria, which
 * is genuinely cheap (one storage metadata listing call, no bytes fetched).
 */
async function backfillByteSize(supabase, { dryRun }) {
  const { data: rows, error } = await supabase
    .from("chat_message_attachments")
    .select("id, bucket, storage_path")
    .is("byte_size", null)
    .limit(MAX_ROWS);
  if (error) throw error;

  let updated = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    const { folder, basename } = splitPath(row.storage_path);
    const { data: entries, error: listError } = await supabase.storage
      .from(row.bucket)
      .list(folder, { search: basename, limit: 100 });
    if (listError) {
      console.warn(
        `skip ${row.id} (${row.bucket}/${row.storage_path}): list failed — ${listError.message}`,
      );
      skipped++;
      continue;
    }

    const entry = entries?.find((e) => e.name === basename);
    const size = entry?.metadata?.size;
    if (typeof size !== "number") {
      console.warn(
        `skip ${row.id} (${row.bucket}/${row.storage_path}): no size metadata — object missing or not yet indexed`,
      );
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] would set byte_size=${size} for ${row.id}`);
      updated++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("chat_message_attachments")
      .update({ byte_size: size })
      .eq("id", row.id);
    if (updateError) {
      console.warn(`skip ${row.id}: update failed — ${updateError.message}`);
      skipped++;
      continue;
    }
    updated++;
  }

  return { total: rows?.length ?? 0, updated, skipped };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );

  const { total, updated, skipped } = await backfillByteSize(supabase, {
    dryRun,
  });

  console.log(
    `${dryRun ? "[dry-run] " : ""}Found ${total} row(s) missing byte_size. Updated ${updated}, skipped ${skipped}.`,
  );
  if (total === MAX_ROWS) {
    console.log(
      `Hit the ${MAX_ROWS}-row cap for one run — re-run this script to continue with the remainder.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
