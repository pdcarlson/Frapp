import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync, readdirSync } from "node:fs";

import {
  DEFAULT_RETENTION_DAYS,
  REHEARSAL_BUCKET,
  REHEARSAL_CONTENT_TYPE,
  assertSafeObjectPath,
  LIST_PAGE_SIZE,
  backupKey,
  checkDeletionSanity,
  isUnchanged,
  listBucketObjects,
  parseObjectPage,
  planSync,
} from "../../storage-backup.mjs";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-01T12:00:00Z");
const retentionMs = DEFAULT_RETENTION_DAYS * DAY;

const obj = (bucket, path, over = {}) => ({
  bucket,
  path,
  size: 1024,
  etag: "abc123",
  mime_type: "image/png",
  updated_at: "2026-08-01T00:00:00Z",
  ...over,
});

const recorded = (bucket, path, over = {}) => ({
  bucket,
  path,
  size: 1024,
  etag: "abc123",
  mime_type: "image/png",
  updated_at: "2026-08-01T00:00:00Z",
  first_backed_up_at: "2026-08-01T01:00:00Z",
  backed_up_at: "2026-08-01T01:00:00Z",
  deleted_at: null,
  ...over,
});

const manifestOf = (objects) => ({ version: 1, objects });

// -- backupKey ---------------------------------------------------------------

test("backupKey namespaces by bucket so same-named objects cannot collide", () => {
  assert.equal(backupKey("storage", "documents", "a/b.pdf"), "storage/documents/a/b.pdf");
  assert.notEqual(
    backupKey("storage", "documents", "avatar.png"),
    backupKey("storage", "profiles", "avatar.png"),
  );
});

// -- isUnchanged -------------------------------------------------------------

test("an object with a matching etag is unchanged, even if updated_at moved", () => {
  // A re-upload of identical bytes bumps updated_at. Re-fetching a 100MB
  // archive for that is the waste the etag comparison exists to avoid.
  assert.equal(
    isUnchanged(obj("documents", "a.pdf", { updated_at: "2026-08-30T00:00:00Z" }), recorded("documents", "a.pdf")),
    true,
  );
});

test("a same-size edit is caught by the etag", () => {
  // The case a size-only comparison waves through, which is why size is only
  // ever the fallback.
  assert.equal(
    isUnchanged(obj("documents", "a.pdf", { etag: "different" }), recorded("documents", "a.pdf")),
    false,
  );
});

test("with no etag on either side it falls back to size and updated_at", () => {
  const remote = obj("documents", "a.pdf", { etag: null });
  assert.equal(isUnchanged(remote, recorded("documents", "a.pdf", { etag: null })), true);
  assert.equal(isUnchanged(remote, recorded("documents", "a.pdf", { etag: null, size: 2048 })), false);
});

test("a tombstoned record is never 'unchanged' -- a re-created object is re-uploaded", () => {
  assert.equal(
    isUnchanged(obj("documents", "a.pdf"), recorded("documents", "a.pdf", { deleted_at: "2026-08-20T00:00:00Z" })),
    false,
  );
});

// -- planSync ----------------------------------------------------------------

test("a first run with no manifest uploads everything", () => {
  const plan = planSync({
    remote: [obj("documents", "a.pdf"), obj("service", "b.jpg")],
    manifest: null,
    nowMs: NOW,
    retentionMs,
  });

  assert.equal(plan.upload.length, 2);
  assert.equal(plan.keep.length, 0);
  assert.equal(plan.manifest.object_count, 2);
});

test("THE POINT: unchanged objects are not re-fetched", () => {
  // chat-archive allows 100MB per object (#1235). Re-downloading the whole
  // corpus nightly is the failure mode incremental sync exists to prevent.
  const plan = planSync({
    remote: [obj("chat-archive", "big.zip"), obj("documents", "new.pdf")],
    manifest: manifestOf([recorded("chat-archive", "big.zip")]),
    nowMs: NOW,
    retentionMs,
  });

  assert.deepEqual(plan.upload.map((o) => o.path), ["new.pdf"]);
  assert.deepEqual(plan.keep.map((o) => o.path), ["big.zip"]);
});

test("first_backed_up_at survives a run that changes the object", () => {
  // It is the only record of how far back a given object's copy reaches, so
  // rebuilding the record from the live listing would silently destroy it.
  const plan = planSync({
    remote: [obj("documents", "a.pdf", { etag: "changed" })],
    manifest: manifestOf([recorded("documents", "a.pdf", { first_backed_up_at: "2026-01-01T00:00:00Z" })]),
    nowMs: NOW,
    retentionMs,
  });

  assert.equal(plan.manifest.objects[0].first_backed_up_at, "2026-01-01T00:00:00Z");
  assert.equal(plan.manifest.objects[0].backed_up_at, new Date(NOW).toISOString());
});

test("an object deleted from Storage is TOMBSTONED, not dropped", () => {
  // A pure mirror would delete the backup copy immediately, which would make
  // "delete a file, restore it" impossible -- the exact drill this exists for.
  const plan = planSync({
    remote: [],
    manifest: manifestOf([recorded("documents", "gone.pdf")]),
    nowMs: NOW,
    retentionMs,
  });

  assert.equal(plan.prune.length, 0, "must not prune on the run that discovers the deletion");
  assert.deepEqual(plan.tombstone.map((o) => o.path), ["gone.pdf"]);
  assert.equal(plan.manifest.objects[0].deleted_at, new Date(NOW).toISOString());
  assert.equal(plan.manifest.object_count, 0);
  assert.equal(plan.manifest.tombstone_count, 1);
});

test("a tombstone is still restorable inside the retention window", () => {
  const plan = planSync({
    remote: [],
    manifest: manifestOf([recorded("documents", "gone.pdf", { deleted_at: "2026-08-29T12:00:00Z" })]),
    nowMs: NOW,
    retentionMs,
  });

  assert.equal(plan.prune.length, 0);
  assert.equal(plan.manifest.objects.length, 1, "the record must survive so a restore can find it");
});

test("a tombstone past the retention window is pruned", () => {
  const plan = planSync({
    remote: [],
    manifest: manifestOf([
      recorded("documents", "ancient.pdf", { deleted_at: new Date(NOW - 31 * DAY).toISOString() }),
    ]),
    nowMs: NOW,
    retentionMs,
  });

  assert.deepEqual(plan.prune.map((o) => o.path), ["ancient.pdf"]);
  assert.equal(plan.manifest.objects.length, 0);
});

test("an unparseable deleted_at is never read as infinitely old", () => {
  // Guarding the NaN matters: `NaN >= retentionMs` is false, so the object is
  // kept -- but a comparison written the other way round would DELETE it.
  const plan = planSync({
    remote: [],
    manifest: manifestOf([recorded("documents", "x.pdf", { deleted_at: "not-a-date" })]),
    nowMs: NOW,
    retentionMs,
  });

  assert.equal(plan.prune.length, 0);
  assert.equal(plan.manifest.objects.length, 1);
});

test("a re-created object is re-uploaded and its tombstone cleared", () => {
  const plan = planSync({
    remote: [obj("documents", "back.pdf")],
    manifest: manifestOf([recorded("documents", "back.pdf", { deleted_at: "2026-08-29T12:00:00Z" })]),
    nowMs: NOW,
    retentionMs,
  });

  assert.deepEqual(plan.upload.map((o) => o.path), ["back.pdf"]);
  assert.equal(plan.manifest.objects[0].deleted_at, null);
});

test("retention 0 prunes on the same run rather than off-by-one-ing a day", () => {
  const plan = planSync({
    remote: [],
    manifest: manifestOf([recorded("documents", "x.pdf")]),
    nowMs: NOW,
    retentionMs: 0,
  });

  assert.deepEqual(plan.prune.map((o) => o.path), ["x.pdf"]);
});

// -- parseObjectPage ---------------------------------------------------------

test("folders are told from files by a null id, never by the name", () => {
  // Storage marks folders with a null id. A name heuristic would skip a real
  // object that happens to look like a directory.
  const { files, folders } = parseObjectPage(
    [
      { name: "sub", id: null },
      { name: "a.pdf", id: "u1", updated_at: "2026-08-01T00:00:00Z", metadata: { size: 10, eTag: '"e1"', mimetype: "application/pdf" } },
    ],
    "documents",
    "chapter-1",
  );

  assert.deepEqual(folders, ["chapter-1/sub"]);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "chapter-1/a.pdf");
});

test("the etag is unquoted so it compares equal to one read back from our manifest", () => {
  const { files } = parseObjectPage(
    [{ name: "a.pdf", id: "u1", metadata: { size: 1, eTag: '"abc123"' } }],
    "documents",
    "",
  );
  assert.equal(files[0].etag, "abc123");
  assert.equal(isUnchanged(files[0], recorded("documents", "a.pdf", { size: 1 })), true);
});

test("a top-level object gets no leading slash", () => {
  const { files } = parseObjectPage([{ name: "a.pdf", id: "u1", metadata: { size: 1 } }], "documents", "");
  assert.equal(files[0].path, "a.pdf");
});

test("an empty or absent page is not an error", () => {
  assert.deepEqual(parseObjectPage([], "documents", ""), { files: [], folders: [] });
  assert.deepEqual(parseObjectPage(undefined, "documents", ""), { files: [], folders: [] });
});

// -- listBucketObjects -------------------------------------------------------

test("listing pages past the page size instead of truncating", async () => {
  // Storage's list endpoint caps each response. Stopping at the first page
  // would silently back up only the first LIST_PAGE_SIZE objects -- a partial
  // backup that reports success, which is the failure this whole issue is about.
  const page1 = Array.from({ length: LIST_PAGE_SIZE }, (_, i) => ({
    name: `f${String(i).padStart(3, "0")}.pdf`,
    id: `u${i}`,
    metadata: { size: 1, eTag: `"e${i}"` },
  }));
  const page2 = [{ name: "last.pdf", id: "uLast", metadata: { size: 1, eTag: '"eLast"' } }];

  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.offset);
    return { ok: true, json: async () => (body.offset === 0 ? page1 : page2) };
  };

  const out = await listBucketObjects({
    supabaseUrl: "https://x.supabase.co",
    serviceKey: "k",
    bucket: "documents",
    fetchImpl,
  });

  assert.deepEqual(calls, [0, LIST_PAGE_SIZE]);
  assert.equal(out.length, LIST_PAGE_SIZE + 1);
  assert.equal(out.at(-1).path, "last.pdf");
});

test("listing recurses into folders", async () => {
  const fetchImpl = async (_url, init) => {
    const { prefix } = JSON.parse(init.body);
    if (prefix === "") {
      return { ok: true, json: async () => [{ name: "nested", id: null }] };
    }
    return {
      ok: true,
      json: async () => [{ name: "deep.pdf", id: "u1", metadata: { size: 1, eTag: '"e"' } }],
    };
  };

  const out = await listBucketObjects({
    supabaseUrl: "https://x.supabase.co",
    serviceKey: "k",
    bucket: "documents",
    fetchImpl,
  });

  assert.deepEqual(out.map((o) => o.path), ["nested/deep.pdf"]);
});

test("a failed listing throws rather than reporting an empty bucket", async () => {
  // An empty result would tombstone every object in the bucket. Failing loudly
  // is the only safe behaviour.
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom" });

  await assert.rejects(
    listBucketObjects({ supabaseUrl: "https://x.supabase.co", serviceKey: "k", bucket: "documents", fetchImpl }),
    /HTTP 500/,
  );
});

test("the service key never appears in a listing error message", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "unauthorized" });
  const secret = "super-secret-service-role-key";

  await assert.rejects(
    listBucketObjects({ supabaseUrl: "https://x.supabase.co", serviceKey: secret, bucket: "documents", fetchImpl }),
    (err) => !err.message.includes(secret),
  );
});

// -- checkDeletionSanity -----------------------------------------------------

const liveManifest = (n) =>
  manifestOf(Array.from({ length: n }, (_, i) => recorded("documents", `f${i}.pdf`)));

test("a short listing that would wipe the corpus is refused before any write", () => {
  // The scenario: a permissions change or partial API failure returns 200 with
  // far fewer objects than exist. From inside planSync that is indistinguishable
  // from a real mass deletion, and it only becomes visible when retention starts
  // pruning a month later -- after 30 green runs.
  const manifest = liveManifest(100);
  const verdict = checkDeletionSanity({ manifest, tombstone: manifest.objects.slice(0, 90) });

  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /90 of 100/);
  assert.match(verdict.reason, /Nothing has been changed offsite/);
});

test("an ordinary run well under the threshold passes", () => {
  const manifest = liveManifest(100);
  assert.equal(checkDeletionSanity({ manifest, tombstone: manifest.objects.slice(0, 10) }).ok, true);
});

test("exactly at the threshold is allowed, not refused", () => {
  const manifest = liveManifest(100);
  assert.equal(checkDeletionSanity({ manifest, tombstone: manifest.objects.slice(0, 50) }).ok, true);
});

test("a small corpus is exempt -- deleting 2 of 3 files is ordinary, not suspicious", () => {
  const manifest = liveManifest(3);
  assert.equal(checkDeletionSanity({ manifest, tombstone: manifest.objects.slice(0, 2) }).ok, true);
});

test("a first run has no manifest and cannot trip the guard", () => {
  assert.equal(checkDeletionSanity({ manifest: null, tombstone: [] }).ok, true);
});

test("tombstones already in the manifest do not count toward the live corpus", () => {
  // Otherwise a backup carrying a long tail of old tombstones would raise the
  // denominator and quietly weaken the guard over time.
  const manifest = manifestOf([
    ...Array.from({ length: 20 }, (_, i) => recorded("documents", `live${i}.pdf`)),
    ...Array.from({ length: 500 }, (_, i) =>
      recorded("documents", `dead${i}.pdf`, { deleted_at: "2026-08-30T00:00:00Z" }),
    ),
  ]);

  const verdict = checkDeletionSanity({
    manifest,
    tombstone: manifest.objects.filter((o) => !o.deleted_at).slice(0, 19),
  });
  assert.equal(verdict.ok, false, "19 of 20 live objects must trip it despite 500 old tombstones");
  assert.equal(verdict.live, 20);
});

// -- The rehearsal canary must be writable into the bucket it targets ---------

test("the rehearsal bucket actually permits the canary's content type", () => {
  // This caught a real bug before it shipped. The rehearsal first targeted
  // `reports`, whose allowed_mime_types is exactly ['application/pdf'] -- so a
  // text/plain canary was rejected with a 400 and the drill failed every single
  // time, for a reason with nothing to do with the backup. Every bucket in this
  // project pins allowed_mime_types, so the pairing has to be checked, not
  // assumed. Reads the migrations rather than a hand-copied list, because a
  // hand-copied list is the thing that goes stale.
  const dir = "supabase/migrations";
  const declaration = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
    .join("\n")
    // The bucket's tuple: its quoted id, then everything up to the closing
    // bracket of its allowed_mime_types array.
    .match(new RegExp(`'${REHEARSAL_BUCKET}',\\s*'${REHEARSAL_BUCKET}',[^\\]]*\\]`));

  assert.ok(declaration, `no storage.buckets declaration found for '${REHEARSAL_BUCKET}'`);
  assert.ok(
    declaration[0].includes(`'${REHEARSAL_CONTENT_TYPE}'`),
    `bucket '${REHEARSAL_BUCKET}' does not allow '${REHEARSAL_CONTENT_TYPE}', so the rehearsal canary would be rejected`,
  );
});

// -- assertSafeObjectPath ----------------------------------------------------

test("a restore refuses an object path that would escape the directory", () => {
  // Object names are attacker-influenced -- a member picks the filename they
  // upload -- and a restore turns each one into a local path.
  assert.throws(() => assertSafeObjectPath("../../etc/passwd"), /unsafe object path/);
  assert.throws(() => assertSafeObjectPath("chapter-1/../../../x"), /unsafe object path/);
  assert.throws(() => assertSafeObjectPath("a//b.pdf"), /unsafe object path/);
});

test("ordinary object paths are accepted unchanged", () => {
  assert.equal(assertSafeObjectPath("chapter-1/bylaws.pdf"), "chapter-1/bylaws.pdf");
  assert.equal(assertSafeObjectPath("file with spaces.png"), "file with spaces.png");
});
