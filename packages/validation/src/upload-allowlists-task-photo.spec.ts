import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedUploadMime, uploadMimeList } from "./upload-allowlists";

const MIGRATION = join(
  __dirname,
  "../../../supabase/migrations/20261113040005_task_photos.sql",
);

/**
 * The `task_photo` kind and the `tasks` bucket must agree (#4565): a type the
 * kind allows and the bucket doesn't mints a URL storage then refuses, and the
 * bucket's list is the only check on the upload itself.
 */
function bucketMimeTypes(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("array[");
  const end = sql.indexOf("]", start);
  expect(start).toBeGreaterThan(-1);
  return [...sql.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("task_photo upload kind mirrors the tasks bucket", () => {
  it("allows exactly the bucket's MIME types", () => {
    expect([...uploadMimeList("task_photo")].sort()).toEqual(
      bucketMimeTypes().sort(),
    );
  });

  it("is photos only: no PDF, no SVG", () => {
    expect(isAllowedUploadMime("task_photo", "image/jpeg")).toBe(true);
    expect(isAllowedUploadMime("task_photo", "application/pdf")).toBe(false);
    expect(isAllowedUploadMime("task_photo", "image/svg+xml")).toBe(false);
  });
});
