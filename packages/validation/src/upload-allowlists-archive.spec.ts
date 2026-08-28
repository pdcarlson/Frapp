import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_ARCHIVE_EXPORT_PART_BYTES,
  MAX_ARCHIVE_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  isAllowedUploadMime,
  isWithinArchiveUploadSizeLimit,
  isWithinUploadSizeLimit,
  uploadMimeList,
} from "./upload-allowlists";

const MIGRATION = join(
  __dirname,
  "../../../supabase/migrations/20260823124000_chat_archive_bucket.sql",
);

/**
 * The `archive` kind and the `chat-archive` bucket must agree.
 *
 * This file's own header says bucket policies "must keep mirroring these MIME
 * lists", which until now was a promise with nothing behind it. Drift here is
 * not cosmetic in either direction: a type in the TypeScript list but not the
 * bucket lets the API mint a signed URL for an upload storage then rejects with
 * a 415 the admin cannot act on, and a type in the bucket but not here is an
 * archive file the wizard refuses for no reason the admin can see.
 */
function bucketMimeTypes(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("array[");
  const end = sql.indexOf("]", start);
  expect(start).toBeGreaterThan(-1);
  return [...sql.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("archive upload kind mirrors the chat-archive bucket", () => {
  it("allows exactly the bucket's MIME types", () => {
    expect([...uploadMimeList("archive")].sort()).toEqual(
      bucketMimeTypes().sort(),
    );
  });

  it("never allows SVG, which is script-bearing markup", () => {
    // Blocked on every other upload surface in the repo; an archive is not a
    // reason to make an exception.
    expect(bucketMimeTypes()).not.toContain("image/svg+xml");
    expect(isAllowedUploadMime("archive", "image/svg+xml")).toBe(false);
  });

  it("accepts the media a Discord export carries and live chat does not", () => {
    for (const mime of ["video/mp4", "audio/mpeg", "image/heic"]) {
      expect(isAllowedUploadMime("archive", mime)).toBe(true);
      expect(isAllowedUploadMime("document", mime)).toBe(false);
    }
  });
});

describe("archive size limits stay off the member-upload ceiling", () => {
  it("does not raise the limit for ordinary uploads", () => {
    // Widening `document` to cover a one-off import would raise the ceiling on
    // every member upload in the product — the trade the bucket migration
    // explicitly rejected.
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    expect(isWithinUploadSizeLimit(MAX_UPLOAD_BYTES + 1)).toBe(false);
  });

  it("allows a 100 MB archive object but not more", () => {
    expect(MAX_ARCHIVE_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
    expect(isWithinArchiveUploadSizeLimit(MAX_ARCHIVE_UPLOAD_BYTES)).toBe(true);
    expect(isWithinArchiveUploadSizeLimit(MAX_ARCHIVE_UPLOAD_BYTES + 1)).toBe(
      false,
    );
    expect(isWithinArchiveUploadSizeLimit(-1)).toBe(false);
  });

  it("caps an export partition far below the object cap", () => {
    // The importer JSON.parses a whole partition into memory on an instance
    // that is also serving live chat.
    expect(MAX_ARCHIVE_EXPORT_PART_BYTES).toBeLessThan(
      MAX_ARCHIVE_UPLOAD_BYTES,
    );
  });
});
