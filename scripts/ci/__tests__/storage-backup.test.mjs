import { test } from "node:test";
import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_BUDGET_MINUTES,
  DEFAULT_RETENTION_DAYS,
  REHEARSAL_BUCKET,
  REHEARSAL_CONTENT_TYPE,
  REHEARSAL_PREFIX,
  STORAGE_BACKUP_PREFIXES,
  assertManifestDestination,
  assertSafeObjectPath,
  assertStorageBackupTarget,
  environmentForStoragePrefix,
  LIST_PAGE_SIZE,
  backupKey,
  checkDeletionSanity,
  isMissingObjectError,
  isRehearsalCanary,
  isUnchanged,
  listBucketObjects,
  MAX_TRANSFER_FAILURES,
  objectId,
  mirrorDestination,
  parseObjectPage,
  parseOffsiteListing,
  planSync,
  projectRefFromSupabaseUrl,
  runPool,
  settleManifest,
  TRANSFER_CONCURRENCY,
  untouchedIds,
  uploadOrder,
  verifyOffsiteMirror,
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

// The small-corpus hole #2335 found: below minCorpus the guard used to pass
// anything, so a listing that came back empty wrote `object_count: 0` over a
// mirror that held objects, and the job concluded success.
test("THE POINT (#2335): a listing that loses every object is refused at any corpus size", () => {
  for (const n of [1, 3, 19]) {
    const manifest = liveManifest(n);
    const verdict = checkDeletionSanity({ manifest, tombstone: manifest.objects });
    assert.equal(verdict.ok, false, `${n} of ${n} gone must be refused`);
    assert.match(verdict.reason, new RegExp(`all ${n} of ${n}`));
    assert.match(verdict.reason, /storage_allow_mass_delete/);
  }
});

test("a small corpus that keeps even one object is still exempt from the ratio", () => {
  const manifest = liveManifest(3);
  assert.equal(checkDeletionSanity({ manifest, tombstone: manifest.objects.slice(0, 2) }).ok, true);
});

test("a mirror that has never held an object passes: production before launch", () => {
  const verdict = checkDeletionSanity({ manifest: manifestOf([]), tombstone: [] });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.live, 0);
});

test("a rehearsal canary vanishing from an otherwise empty corpus is not a wipe", () => {
  // The rehearsal backs its canary up and deletes it, so the next nightly on
  // staging (which holds nothing else) sees its only live object go.
  const canary = recorded(REHEARSAL_BUCKET, `${REHEARSAL_PREFIX}/canary-1.txt`);
  assert.equal(isRehearsalCanary(canary), true);
  const verdict = checkDeletionSanity({ manifest: manifestOf([canary]), tombstone: [canary] });
  assert.equal(verdict.ok, true);
});

test("a canary does not keep a real wipe from counting as one", () => {
  const canary = recorded(REHEARSAL_BUCKET, `${REHEARSAL_PREFIX}/canary-1.txt`);
  const real = recorded("profiles", "u1/avatar.png");
  const verdict = checkDeletionSanity({ manifest: manifestOf([canary, real]), tombstone: [canary, real] });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.live, 1);
});

test("only the rehearsal folder of the rehearsal bucket is a canary", () => {
  assert.equal(isRehearsalCanary(recorded(REHEARSAL_BUCKET, "chapter-1/bylaws.pdf")), false);
  assert.equal(isRehearsalCanary(recorded("profiles", `${REHEARSAL_PREFIX}/x.txt`)), false);
});

// -- assertManifestDestination ----------------------------------------------

const DEST = mirrorDestination({
  environment: "production",
  projectRef: "unttyvyfezddlyafcydh",
  bucket: "backups",
  prefix: "storage-production",
});

test("planSync records the destination in the manifest it writes", () => {
  const plan = planSync({ remote: [], manifest: null, nowMs: NOW, retentionMs, destination: DEST });
  assert.deepEqual(plan.manifest.destination, {
    environment: "production",
    supabase_project_ref: "unttyvyfezddlyafcydh",
    bucket: "backups",
    prefix: "storage-production",
  });
});

test("THE POINT (#2335): no manifest under the prefix is refused, not read as a first run", () => {
  // A typo'd BACKUP_S3_BUCKET reads an empty place. The old reading ("first
  // full backup") started a fresh mirror there and concluded success.
  assert.throws(
    () => assertManifestDestination({ manifest: null, expected: DEST }),
    /No manifest at storage-production\/manifest\.json.*storage_new_destination/s,
  );
});

test("a new destination on purpose is accepted with the override", () => {
  assert.doesNotThrow(() => assertManifestDestination({ manifest: null, expected: DEST, allowNewDestination: true }));
});

test("a manifest recording another bucket, prefix or project is refused", () => {
  for (const [key, value] of [
    ["bucket", "other-bucket"],
    ["prefix", "storage"],
    ["supabase_project_ref", "hnoyzpidbmizhbqaiity"],
    ["environment", "staging"],
  ]) {
    const manifest = { ...manifestOf([]), destination: { ...DEST, [key]: value } };
    assert.throws(
      () => assertManifestDestination({ manifest, expected: DEST }),
      new RegExp(`records a different destination \\(${key} differs\\)`),
      key,
    );
  }
});

test("verify's refusal names no override it can't take", () => {
  // `verify` is read-only and ignores STORAGE_BACKUP_NEW_DESTINATION.
  for (const manifest of [null, { ...manifestOf([]), destination: { ...DEST, bucket: "other" } }]) {
    assert.throws(
      () => assertManifestDestination({ manifest, expected: DEST, readOnly: true }),
      (err) => !/STORAGE_BACKUP_NEW_DESTINATION|Nothing has been written/.test(err.message) && /Check BACKUP_S3_BUCKET/.test(err.message),
    );
  }
});

test("a matching manifest, or one from before the field existed, is accepted", () => {
  assert.doesNotThrow(() =>
    assertManifestDestination({ manifest: { ...manifestOf([]), destination: { ...DEST } }, expected: DEST }),
  );
  assert.doesNotThrow(() => assertManifestDestination({ manifest: manifestOf([]), expected: DEST }));
});

// -- planSync against the offsite listing ------------------------------------

const offsiteOf = (...records) => new Map(records.map((r) => [backupKey("storage", r.bucket, r.path), r.size]));

test("THE POINT (#2335): an unchanged object R2 lost is re-uploaded, not carried forward", () => {
  // By etag it is unchanged, so without the listing it would never be copied
  // again and every later run would fail on the same missing key.
  const a = recorded("documents", "a.pdf");
  const b = recorded("documents", "b.pdf", { first_backed_up_at: "2026-07-01T00:00:00Z" });
  const plan = planSync({
    remote: [obj("documents", "a.pdf"), obj("documents", "b.pdf")],
    manifest: manifestOf([a, b]),
    nowMs: NOW,
    retentionMs,
    prefix: "storage",
    offsite: offsiteOf(a),
  });
  assert.deepEqual(plan.upload.map((o) => o.path), ["b.pdf"]);
  assert.deepEqual(plan.missingOffsite.map((o) => [o.record.path, o.kind, o.recovered]), [["b.pdf", "missing", true]]);
  const rebuilt = plan.manifest.objects.find((o) => o.path === "b.pdf");
  assert.equal(rebuilt.first_backed_up_at, "2026-07-01T00:00:00Z", "history survives the re-upload");
});

test("a tombstone whose bytes R2 lost is marked once, kept in the index, and not reported again", () => {
  const dead = recorded("documents", "gone.pdf", { deleted_at: "2026-08-30T00:00:00Z" });
  const first = planSync({ remote: [], manifest: manifestOf([dead]), nowMs: NOW, retentionMs, prefix: "storage", offsite: new Map() });
  assert.deepEqual(first.missingOffsite.map((o) => [o.record.path, o.recovered]), [["gone.pdf", false]]);
  const marked = first.manifest.objects[0];
  assert.equal(marked.lost_offsite_at, new Date(NOW).toISOString());
  assert.deepEqual(verifyOffsiteMirror({ manifest: first.manifest, prefix: "storage", listing: new Map() }), []);

  const second = planSync({ remote: [], manifest: first.manifest, nowMs: NOW + DAY, retentionMs, prefix: "storage", offsite: new Map() });
  assert.equal(second.missingOffsite.length, 0, "the run that found it already failed");
  assert.equal(second.manifest.objects[0].lost_offsite_at, marked.lost_offsite_at);
});

test("a lost mark clears if the bytes turn up offsite after all", () => {
  const dead = recorded("documents", "gone.pdf", { deleted_at: "2026-08-30T00:00:00Z", lost_offsite_at: "2026-08-31T00:00:00Z" });
  const plan = planSync({ remote: [], manifest: manifestOf([dead]), nowMs: NOW, retentionMs, prefix: "storage", offsite: offsiteOf(dead) });
  assert.equal(plan.manifest.objects[0].lost_offsite_at, null);
  assert.equal(plan.missingOffsite.length, 0);
});

test("a legacy tombstone at a stale size is not marked lost: its bytes are there", () => {
  const dead = recorded("documents", "gone.pdf", { size: 1024, deleted_at: "2026-08-30T00:00:00Z" });
  const plan = planSync({
    remote: [],
    manifest: manifestOf([dead]),
    nowMs: NOW,
    retentionMs,
    prefix: "storage",
    offsite: new Map([["storage/documents/gone.pdf", 999]]),
  });
  assert.equal(plan.missingOffsite.length, 0);
  assert.equal(plan.manifest.objects[0].lost_offsite_at, null);
});

test("a legacy record adopts the offsite size once it matches Storage's, then is length-checked", () => {
  const a = recorded("documents", "a.pdf", { size: 1024 });
  const plan = planSync({
    remote: [obj("documents", "a.pdf")],
    manifest: manifestOf([a]),
    nowMs: NOW,
    retentionMs,
    prefix: "storage",
    offsite: offsiteOf(a),
  });
  assert.equal(plan.manifest.objects[0].backed_up_bytes, 1024);
  const truncated = new Map([["storage/documents/a.pdf", 0]]);
  assert.equal(verifyOffsiteMirror({ manifest: plan.manifest, prefix: "storage", listing: truncated }).length, 1);
});

test("a live object offsite at the wrong written size is re-uploaded", () => {
  const a = recorded("documents", "a.pdf", { backed_up_bytes: 1024 });
  const plan = planSync({
    remote: [obj("documents", "a.pdf")],
    manifest: manifestOf([a]),
    nowMs: NOW,
    retentionMs,
    prefix: "storage",
    offsite: new Map([["storage/documents/a.pdf", 3]]),
  });
  assert.deepEqual(plan.upload.map((o) => o.path), ["a.pdf"]);
  assert.deepEqual(plan.missingOffsite.map((g) => [g.kind, g.recovered]), [["size", true]]);
});

test("the last offsite loss is recorded, and carried forward until the next one", () => {
  const dead = recorded("documents", "gone.pdf", { deleted_at: "2026-08-30T00:00:00Z" });
  const first = planSync({ remote: [], manifest: manifestOf([dead]), nowMs: NOW, retentionMs, prefix: "storage", offsite: new Map() });
  assert.deepEqual(first.manifest.last_offsite_loss, {
    found_at: new Date(NOW).toISOString(),
    objects: [{ bucket: "documents", path: "gone.pdf", kind: "missing", recovered: false }],
  });
  const second = planSync({ remote: [], manifest: first.manifest, nowMs: NOW + DAY, retentionMs, prefix: "storage", offsite: new Map() });
  assert.deepEqual(second.manifest.last_offsite_loss, first.manifest.last_offsite_loss);
});

test("without an offsite listing nothing is judged missing", () => {
  const a = recorded("documents", "a.pdf");
  const plan = planSync({ remote: [obj("documents", "a.pdf")], manifest: manifestOf([a]), nowMs: NOW, retentionMs });
  assert.equal(plan.keep.length, 1);
  assert.deepEqual(plan.missingOffsite, []);
});

// -- isMissingObjectError ---------------------------------------------------

test("only a missing key reads as 'no manifest'; a denied or failed read does not", () => {
  assert.equal(
    isMissingObjectError("fatal error: An error occurred (404) when calling the HeadObject operation: Not Found"),
    true,
  );
  assert.equal(isMissingObjectError('fatal error: Key "storage/manifest.json" does not exist'), true);
  assert.equal(isMissingObjectError("An error occurred (NoSuchKey) when calling the GetObject operation"), true);
  assert.equal(
    isMissingObjectError("fatal error: An error occurred (403) when calling the HeadObject operation: Forbidden"),
    false,
  );
  assert.equal(isMissingObjectError("Could not connect to the endpoint URL"), false);
  assert.equal(isMissingObjectError(undefined), false);
});

// -- parseOffsiteListing / verifyOffsiteMirror --------------------------------

test("an offsite listing parses to key -> size, and an empty prefix to nothing", () => {
  const listing = parseOffsiteListing(JSON.stringify([["storage/documents/a.pdf", 1024]]));
  assert.equal(listing.get("storage/documents/a.pdf"), 1024);
  assert.equal(parseOffsiteListing("").size, 0);
  assert.equal(parseOffsiteListing("null\n").size, 0);
  assert.throws(() => parseOffsiteListing(JSON.stringify({ Contents: [] })), /\[key, size\] pairs/);
});

test("a mirror holding every manifest object at its size verifies", () => {
  const manifest = manifestOf([
    recorded("documents", "a.pdf"),
    recorded("profiles", "b.png", { deleted_at: "2026-08-30T00:00:00Z" }),
  ]);
  const listing = new Map([
    ["storage/documents/a.pdf", 1024],
    ["storage/profiles/b.png", 1024],
    ["storage/manifest.json", 300],
  ]);
  assert.deepEqual(verifyOffsiteMirror({ manifest, prefix: "storage", listing }), []);
});

test("THE POINT (#2335): an object the manifest lists but R2 lacks fails, tombstones included", () => {
  // A lifecycle rule or a hand deletion in R2 leaves the index claiming bytes
  // nobody can restore. A tombstone is a promise too: it says the deleted file
  // is recoverable for the retention window.
  const manifest = manifestOf([
    recorded("documents", "a.pdf"),
    recorded("profiles", "b.png", { deleted_at: "2026-08-30T00:00:00Z" }),
  ]);
  const problems = verifyOffsiteMirror({ manifest, prefix: "storage", listing: new Map() });
  assert.equal(problems.length, 2);
  assert.match(problems[0].message, /documents\/a\.pdf is in the manifest but not offsite/);
});

test("a size mismatch fails against the bytes the job recorded writing", () => {
  const manifest = manifestOf([
    recorded("documents", "a.pdf", { size: 1024, backed_up_bytes: 1000 }),
    recorded("documents", "b.pdf", { size: 1024, backed_up_bytes: 1024 }),
  ]);
  const listing = new Map([
    ["storage/documents/a.pdf", 1000],
    ["storage/documents/b.pdf", 0],
  ]);
  const problems = verifyOffsiteMirror({ manifest, prefix: "storage", listing });
  assert.deepEqual(problems.map((p) => p.message), ["documents/b.pdf is 0 bytes offsite, but 1024 were written"]);
});

test("a record from before backed_up_bytes is checked for existence only", () => {
  // Its `size` is Storage's listing, which can go stale between the listing
  // and the download, so comparing it would call good bytes missing.
  const manifest = manifestOf([recorded("documents", "a.pdf", { size: 1024 })]);
  const listing = new Map([["storage/documents/a.pdf", 7]]);
  assert.deepEqual(verifyOffsiteMirror({ manifest, prefix: "storage", listing }), []);
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

// -- assertStorageBackupTarget ----------------------------------------------

const STAGING_REF = "stagingrefaaaaaa";
const PRODUCTION_REF = "productionrefbbb";
const lookupEnvironment = (name) => {
  if (name === "staging") {
    return { name, supabaseProjectRef: STAGING_REF, supabaseProjectName: "frapp-staging" };
  }
  if (name === "production") {
    return { name, supabaseProjectRef: PRODUCTION_REF, supabaseProjectName: "frapp-prod" };
  }
  throw new Error(`Unknown environment "${name}"`);
};
const stagingUrl = `https://${STAGING_REF}.supabase.co`;
const productionUrl = `https://${PRODUCTION_REF}.supabase.co`;
const fence = (over = {}) =>
  assertStorageBackupTarget({
    supabaseUrl: stagingUrl,
    prefix: "storage",
    mode: "backup",
    lookupEnvironment,
    allowProductionRehearsal: false,
    allowProductionRestore: false,
    ...over,
  });

test("prefix storage is staging and storage-production is production", () => {
  assert.equal(environmentForStoragePrefix("storage"), "staging");
  assert.equal(environmentForStoragePrefix("storage-production"), "production");
  assert.equal(environmentForStoragePrefix("tmp"), null);
  assert.equal(STORAGE_BACKUP_PREFIXES.staging, "storage");
  assert.equal(STORAGE_BACKUP_PREFIXES.production, "storage-production");
});

test("projectRefFromSupabaseUrl reads the first label of a hosted host", () => {
  assert.equal(projectRefFromSupabaseUrl(stagingUrl), STAGING_REF);
  assert.equal(projectRefFromSupabaseUrl(`${stagingUrl}/`), STAGING_REF);
});

test("a local stack URL is refused, not parsed as a truncated ref", () => {
  // The first DNS label of 127.0.0.1 is `127`. Treating that as a project ref
  // would fail the environments.json comparison with a confusing message
  // instead of "this is not a hosted project".
  assert.throws(() => projectRefFromSupabaseUrl("http://127.0.0.1:54321"), /not a hosted Supabase project/);
  assert.throws(() => projectRefFromSupabaseUrl("http://localhost:54321"), /not a hosted Supabase project/);
});

test("a missing or unparseable SUPABASE_URL is refused before any write", () => {
  assert.throws(() => projectRefFromSupabaseUrl(""), /SUPABASE_URL is missing/);
  assert.throws(() => projectRefFromSupabaseUrl("not a url"), /not a valid URL/);
});

test("a hosted http URL is refused so the service-role key is not sent in the clear", () => {
  // Host check passes (`<ref>.supabase.co`); protocol must still be https.
  // Local-stack http URLs fail the host check first — that assertion is above.
  assert.throws(
    () => projectRefFromSupabaseUrl(`http://${STAGING_REF}.supabase.co`),
    /uses http: rather than https:/,
  );
});

test("THE POINT: a staging prefix against the production URL is refused", () => {
  // The failure the CLI used to permit: a local `rehearse --prefix storage`
  // with production SUPABASE_URL would write a canary into production Storage.
  assert.throws(
    () => fence({ supabaseUrl: productionUrl, prefix: "storage", mode: "rehearse" }),
    /names project productionrefbbb[\s\S]*staging project/,
  );
});

test("a production prefix against the staging URL is refused", () => {
  assert.throws(
    () => fence({ prefix: "storage-production" }),
    /names project stagingrefaaaaaa[\s\S]*production project/,
  );
});

test("matching prefix and URL is accepted for backup; restore of production needs the override", () => {
  assert.deepEqual(fence(), { environment: "staging", projectRef: STAGING_REF });
  assert.deepEqual(
    fence({ supabaseUrl: productionUrl, prefix: "storage-production", mode: "backup" }),
    { environment: "production", projectRef: PRODUCTION_REF },
  );
  assert.throws(
    () => fence({ supabaseUrl: productionUrl, prefix: "storage-production", mode: "restore" }),
    /Refusing a Storage restore against production/,
  );
  assert.deepEqual(
    fence({
      supabaseUrl: productionUrl,
      prefix: "storage-production",
      mode: "restore",
      allowProductionRestore: true,
    }),
    { environment: "production", projectRef: PRODUCTION_REF },
  );
});

test("a staging rehearsal against the staging URL is accepted", () => {
  assert.equal(fence({ mode: "rehearse" }).environment, "staging");
});

test("a production rehearsal is refused unless the override is set", () => {
  assert.throws(
    () =>
      fence({
        supabaseUrl: productionUrl,
        prefix: "storage-production",
        mode: "rehearse",
        allowProductionRehearsal: false,
      }),
    /Refusing a Storage rehearsal against production/,
  );
  assert.equal(
    fence({
      supabaseUrl: productionUrl,
      prefix: "storage-production",
      mode: "rehearse",
      allowProductionRehearsal: true,
    }).environment,
    "production",
  );
});

test("the production rehearsal override can come from the environment", () => {
  // The CLI omits allowProductionRehearsal; the env var is the path a real
  // local rehearsal takes. Passing false above never executes the ?? fallback.
  const prev = process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_REHEARSAL;
  try {
    delete process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_REHEARSAL;
    assert.throws(
      () =>
        fence({
          supabaseUrl: productionUrl,
          prefix: "storage-production",
          mode: "rehearse",
          allowProductionRehearsal: undefined,
        }),
      /Refusing a Storage rehearsal against production/,
    );
    process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_REHEARSAL = "true";
    assert.equal(
      fence({
        supabaseUrl: productionUrl,
        prefix: "storage-production",
        mode: "rehearse",
        allowProductionRehearsal: undefined,
      }).environment,
      "production",
    );
  } finally {
    if (prev === undefined) delete process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_REHEARSAL;
    else process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_REHEARSAL = prev;
  }
});

test("the production restore override can come from the environment", () => {
  const prev = process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_RESTORE;
  try {
    delete process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_RESTORE;
    assert.throws(
      () =>
        fence({
          supabaseUrl: productionUrl,
          prefix: "storage-production",
          mode: "restore",
          allowProductionRestore: undefined,
        }),
      /Refusing a Storage restore against production/,
    );
    process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_RESTORE = "true";
    assert.equal(
      fence({
        supabaseUrl: productionUrl,
        prefix: "storage-production",
        mode: "restore",
        allowProductionRestore: undefined,
      }).environment,
      "production",
    );
  } finally {
    if (prev === undefined) delete process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_RESTORE;
    else process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_RESTORE = prev;
  }
});

test("an unknown prefix is refused rather than treated as a scratch namespace", () => {
  assert.throws(() => fence({ prefix: "scratch" }), /Unknown Storage backup prefix 'scratch'/);
});

test("BACKUP_ENVIRONMENT must match the prefix when set", () => {
  assert.throws(
    () => fence({ expectedEnvironment: "production" }),
    /prefix 'storage' belongs to staging/,
  );
  assert.deepEqual(fence({ expectedEnvironment: "staging" }), {
    environment: "staging",
    projectRef: STAGING_REF,
  });
});

test("the committed staging URL is accepted by the default lookup", () => {
  // No injected lookup — this is the fence a local rehearsal actually hits.
  const got = assertStorageBackupTarget({
    supabaseUrl: "https://hnoyzpidbmizhbqaiity.supabase.co",
    prefix: "storage",
    mode: "rehearse",
    allowProductionRehearsal: false,
  });
  assert.equal(got.environment, "staging");
  assert.equal(got.projectRef, "hnoyzpidbmizhbqaiity");
});

test("the GHA action uses the same assertStorageBackupTarget fence as the CLI", () => {
  const yml = readFileSync(".github/actions/storage-offsite-backup/action.yml", "utf8");
  assert.match(yml, /assertStorageBackupTarget/);
  assert.doesNotMatch(yml, /REF="\$\{HOST%%\.\*\}"/);
  const setup = yml.indexOf("actions/setup-node@v4");
  const fence = yml.indexOf("assertStorageBackupTarget");
  assert.ok(setup !== -1 && fence !== -1 && setup < fence, "Setup Node must run before the fence import");
  assert.equal((yml.match(/actions\/setup-node@v4/g) || []).length, 1, "one Setup Node step, not a leftover duplicate");
});

// -- Throughput and the budget (#2916) ---------------------------------------

test("runPool never runs more than `limit` at once, and runs every item", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const { done, failures } = await runPool(items, { limit: 3 }, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight -= 1;
  });
  assert.equal(peak, 3);
  assert.deepEqual([...done].sort((a, b) => a - b), items);
  assert.deepEqual(failures, []);
});

test("runPool starts nothing new once told to stop, and finishes what is in flight", async () => {
  const started = [];
  let finished = 0;
  const { done } = await runPool(
    Array.from({ length: 10 }, (_, i) => i),
    { limit: 2, shouldStop: () => started.length >= 4 },
    async (i) => {
      started.push(i);
      await new Promise((r) => setTimeout(r, 2));
      finished += 1;
    },
  );
  assert.equal(started.length, 4);
  assert.equal(finished, 4, "the in-flight items completed before runPool returned");
  assert.equal(done.length, 4);
});

test("runPool stops at maxFailures, lets in-flight work finish, and returns what completed", async () => {
  let finished = 0;
  const started = [];
  const { done, failures } = await runPool([0, 1, 2, 3, 4, 5], { limit: 2 }, async (i) => {
    started.push(i);
    if (i === 0) throw new Error("boom 0");
    await new Promise((r) => setTimeout(r, 5));
    finished += 1;
  });
  assert.deepEqual(started, [0, 1], "with the default of 1, no item starts after the failure");
  assert.equal(finished, 1, "the sibling in flight completed first");
  assert.deepEqual(done, [1], "and is returned, so the caller can still record it");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].item, 0);
  assert.match(failures[0].error.message, /boom 0/);
});

test("THE POINT (#2916 review): under a higher maxFailures a failure doesn't stop the rest", async () => {
  const { done, failures } = await runPool([0, 1, 2, 3, 4, 5], { limit: 2, maxFailures: 3 }, async (i) => {
    if (i % 2 === 0) throw new Error(`boom ${i}`);
  });
  assert.deepEqual([...done].sort(), [1, 3, 5]);
  assert.deepEqual(failures.map((f) => f.item).sort(), [0, 2, 4]);
});

test("runPool hands each worker a stable slot, so two never share a scratch file", async () => {
  const busy = new Set();
  await runPool(Array.from({ length: 12 }, (_, i) => i), { limit: 4 }, async (_i, slot) => {
    assert.ok(slot >= 0 && slot < 4);
    assert.equal(busy.has(slot), false, `slot ${slot} used by two items at once`);
    busy.add(slot);
    await new Promise((r) => setTimeout(r, 1));
    busy.delete(slot);
  });
});

test("runPool with nothing to do, or told to stop from the start, runs nothing", async () => {
  assert.deepEqual(await runPool([], { limit: 4 }, () => assert.fail("ran")), { done: [], failures: [] });
  assert.deepEqual(await runPool([1, 2], { limit: 4, shouldStop: () => true }, () => assert.fail("ran")), { done: [], failures: [] });
  await assert.rejects(runPool([1], { limit: 0 }, () => {}), /positive integer/);
});

test("the default budget, concurrency and failure cap are real numbers the job can use", () => {
  assert.ok(Number.isInteger(TRANSFER_CONCURRENCY) && TRANSFER_CONCURRENCY > 1);
  assert.ok(DEFAULT_BUDGET_MINUTES > 0);
  assert.ok(Number.isInteger(MAX_TRANSFER_FAILURES) && MAX_TRANSFER_FAILURES > 1);
});

test("uploads go recoveries first, then the rehearsal canary, then listing order", () => {
  const previous = manifestOf([recorded("docs", "lost.pdf", { backed_up_bytes: 1024 })]);
  const canary = obj(REHEARSAL_BUCKET, `${REHEARSAL_PREFIX}/canary-1.txt`);
  const remote = [obj("chat-archive", "1.png"), canary, obj("chat-archive", "2.png"), obj("docs", "lost.pdf")];
  const plan = planSync({ remote, manifest: previous, nowMs: NOW, retentionMs, prefix: "storage", offsite: new Map() });
  assert.deepEqual(
    uploadOrder(plan).map((o) => o.path),
    ["lost.pdf", `${REHEARSAL_PREFIX}/canary-1.txt`, "1.png", "2.png"],
  );
});

test("untouchedIds names planned uploads and prunes that didn't complete, and nothing else", () => {
  const expired = recorded("docs", "old.pdf", { deleted_at: new Date(NOW - retentionMs - DAY).toISOString() });
  const previous = manifestOf([recorded("docs", "a.pdf"), expired]);
  const plan = planSync({ remote: [obj("docs", "a.pdf"), obj("docs", "b.pdf"), obj("docs", "c.pdf")], manifest: previous, nowMs: NOW, retentionMs });
  const ids = untouchedIds({ plan, uploaded: new Set([objectId(obj("docs", "b.pdf"))]), pruned: new Set() });
  assert.deepEqual([...ids].sort(), [objectId(obj("docs", "c.pdf")), objectId(expired)].sort());
});

const settle = (plan, previous, { uploaded = plan.upload, pruned = plan.prune } = {}) =>
  settleManifest({
    plan,
    previous,
    uploaded: new Set(uploaded.map(objectId)),
    pruned: new Set(pruned.map(objectId)),
  });

test("a run that did everything it planned writes planSync's manifest untouched", () => {
  const previous = manifestOf([recorded("docs", "a.pdf")]);
  const plan = planSync({ remote: [obj("docs", "a.pdf", { etag: "new" }), obj("docs", "b.pdf")], manifest: previous, nowMs: NOW, retentionMs });
  assert.equal(settle(plan, previous), plan.manifest);
});

test("THE POINT (#2916): a new object the run never reached is left out, so the next run uploads it", () => {
  const previous = manifestOf([recorded("docs", "a.pdf")]);
  const remote = [obj("docs", "a.pdf"), obj("chat-archive", "1.png"), obj("chat-archive", "2.png")];
  const plan = planSync({ remote, manifest: previous, nowMs: NOW, retentionMs });
  const first = plan.upload.find((o) => o.path === "1.png");
  const settled = settle(plan, previous, { uploaded: [first] });
  assert.deepEqual(settled.objects.map((o) => o.path).sort(), ["1.png", "a.pdf"]);
  assert.equal(settled.object_count, 2);

  const nextPlan = planSync({ remote, manifest: settled, nowMs: NOW + DAY, retentionMs });
  assert.deepEqual(nextPlan.upload.map((o) => o.path), ["2.png"], "only what was left is replanned");
});

test("a changed object the run never reached keeps its previous record: its old bytes are still offsite", () => {
  const old = recorded("docs", "a.pdf", { backed_up_bytes: 1024 });
  const previous = manifestOf([old]);
  const plan = planSync({ remote: [obj("docs", "a.pdf", { etag: "edited", size: 2048 })], manifest: previous, nowMs: NOW, retentionMs });
  const settled = settle(plan, previous, { uploaded: [] });
  assert.deepEqual(settled.objects, [old]);
  assert.equal(planSync({ remote: [obj("docs", "a.pdf", { etag: "edited", size: 2048 })], manifest: settled, nowMs: NOW, retentionMs }).upload.length, 1);
});

test("a re-created object the run never reached keeps its tombstone", () => {
  const tomb = recorded("docs", "a.pdf", { deleted_at: "2026-08-20T00:00:00Z" });
  const previous = manifestOf([tomb]);
  const plan = planSync({ remote: [obj("docs", "a.pdf")], manifest: previous, nowMs: NOW, retentionMs });
  const settled = settle(plan, previous, { uploaded: [] });
  assert.deepEqual(settled.objects, [tomb]);
  assert.equal(settled.object_count, 0);
  assert.equal(settled.tombstone_count, 1);
});

test("a prune the run never reached keeps its tombstone, so the next run prunes it", () => {
  const expired = recorded("docs", "old.pdf", { deleted_at: new Date(NOW - retentionMs - DAY).toISOString() });
  const previous = manifestOf([recorded("docs", "a.pdf"), expired]);
  const plan = planSync({ remote: [obj("docs", "a.pdf")], manifest: previous, nowMs: NOW, retentionMs });
  assert.equal(plan.prune.length, 1);
  const settled = settle(plan, previous, { pruned: [] });
  assert.deepEqual(settled.objects.map((o) => o.path), ["a.pdf", "old.pdf"]);
  assert.equal(settled.tombstone_count, 1);
  assert.equal(planSync({ remote: [obj("docs", "a.pdf")], manifest: settled, nowMs: NOW, retentionMs }).prune.length, 1);
});

test("an unpruned object that left Storage this same run is written back as a tombstone, not live", () => {
  const previous = manifestOf([recorded("docs", "a.pdf"), recorded("docs", "b.pdf")]);
  const plan = planSync({ remote: [obj("docs", "a.pdf")], manifest: previous, nowMs: NOW, retentionMs: 0 });
  assert.equal(plan.prune.length, 1);
  const settled = settle(plan, previous, { pruned: [] });
  const b = settled.objects.find((o) => o.path === "b.pdf");
  assert.equal(b.deleted_at, new Date(NOW).toISOString());
  assert.equal(settled.object_count, 1);
  assert.equal(settled.tombstone_count, 1);
});

test("a lost object the run didn't re-upload is marked deferred in this run's loss, not recovered", () => {
  const kept = recorded("docs", "a.pdf", { backed_up_bytes: 1024 });
  const previous = manifestOf([kept]);
  const plan = planSync({ remote: [obj("docs", "a.pdf")], manifest: previous, nowMs: NOW, retentionMs, prefix: "storage", offsite: new Map() });
  assert.equal(plan.upload.length, 1);
  const settled = settle(plan, previous, { uploaded: [] });
  assert.deepEqual(settled.objects, [kept], "the record stays, so the offsite check after the write names it");
  assert.deepEqual(settled.last_offsite_loss.objects, [{ bucket: "docs", path: "a.pdf", kind: "missing", recovered: false, deferred: true }]);
});

test("an earlier run's loss is carried forward untouched by a deferral", () => {
  const earlier = { found_at: "2026-08-01T00:00:00Z", objects: [{ bucket: "docs", path: "new.pdf", kind: "missing", recovered: true }] };
  const previous = { ...manifestOf([]), last_offsite_loss: earlier };
  const plan = planSync({ remote: [obj("docs", "new.pdf")], manifest: previous, nowMs: NOW, retentionMs, prefix: "storage", offsite: new Map() });
  assert.deepEqual(settle(plan, previous, { uploaded: [] }).last_offsite_loss, earlier);
});

test("both Storage jobs leave the budget at least 15 minutes to write before the job timeout", () => {
  const workflow = readFileSync(".github/workflows/db-backup.yml", "utf8");
  for (const job of ["backup-staging-storage", "backup-production-storage"]) {
    const start = workflow.indexOf(`  ${job}:`);
    const next = workflow.indexOf("\n  backup-", start + 1);
    const block = workflow.slice(start, next === -1 ? undefined : next);
    const timeout = Number(block.match(/timeout-minutes: (\d+)/)?.[1]);
    assert.ok(timeout >= DEFAULT_BUDGET_MINUTES + 15, `${job}: timeout ${timeout} vs budget ${DEFAULT_BUDGET_MINUTES}`);
    assert.doesNotMatch(block, /STORAGE_BACKUP_BUDGET_MINUTES/, `${job} overrides the budget; keep the check above in step with it`);
  }
});

// -- The CLI and the workflow wire the #2335 checks --------------------------
// storage-backup-run.mjs runs its mode on import, so these read it as source.

test("the backup checks the destination before listing, and the offsite mirror after writing", () => {
  const src = readFileSync("scripts/storage-backup-run.mjs", "utf8");
  const body = src.slice(src.indexOf("async function runBackup"), src.indexOf("async function runRestore"));
  const destination = body.indexOf("assertManifestDestination(");
  const listing = body.indexOf("collectRemote(");
  const manifestWrite = body.indexOf("/manifest.json`, \"--only-show-errors\"], { endpoint });");
  const offsite = body.indexOf("verifyOffsite(");
  assert.ok(destination !== -1 && destination < listing, "destination is checked before Storage is listed");
  assert.ok(manifestWrite !== -1 && offsite > manifestWrite, "the offsite mirror is verified after the manifest is written");
  assert.doesNotMatch(body, /object_count !== plan\.manifest\.object_count/, "the read-back compares bytes, not a count with itself");
  assert.match(src, /verify: runVerify/);
  // The offsite listing grows with the corpus; Node's 1 MiB default buffer
  // turns it into ENOBUFS on every run once a prefix holds a few thousand keys.
  // Both the blocking and the pooled call take it from one options object.
  assert.match(src.slice(src.indexOf("const AWS_EXEC_OPTIONS"), src.indexOf("function awsFailure")), /maxBuffer: 512 \* 1024 \* 1024/);
  const callers = src.slice(src.indexOf("function aws("), src.indexOf("function parseArgs"));
  assert.equal((callers.match(/AWS_EXEC_OPTIONS/g) || []).length, 2, "aws and awsAsync both pass AWS_EXEC_OPTIONS");
});

test("the backup uploads in uploadOrder and budgets both pools; the rehearsal cleans up a failed backup", () => {
  const src = readFileSync("scripts/storage-backup-run.mjs", "utf8");
  const body = src.slice(src.indexOf("async function runBackup"), src.indexOf("async function runRestore"));
  assert.match(body, /runPool\(uploadOrder\(plan\), pool\(\)/);
  assert.match(body, /runPool\(plan\.prune, pool\(\)/);
  assert.match(body, /shouldStop: overBudget/);
  const rehearsal = src.slice(src.indexOf("async function runRehearsal"), src.indexOf("async function runVerify"));
  const backup = rehearsal.indexOf("await runBackup(opts)");
  const cleanup = rehearsal.indexOf("await deleteCanary().catch(");
  assert.ok(backup !== -1 && cleanup > backup && /try \{\s*await runBackup\(opts\);\s*\} catch/.test(rehearsal));
});

test("a failed manifest read is a failure; only a missing key is 'no manifest'", () => {
  const src = readFileSync("scripts/storage-backup-run.mjs", "utf8");
  const body = src.slice(src.indexOf("function readManifest"), src.indexOf("function verifyOffsite"));
  assert.match(body, /isMissingObjectError\(err\.stderr\)/);
  assert.doesNotMatch(body, /allowFailure: true/);
});

test("each override reaches only the Storage job its dispatch input names", () => {
  // One tick for staging must not also disarm production's guard (#2335 review).
  const workflow = readFileSync(".github/workflows/db-backup.yml", "utf8");
  for (const input of ["storage_new_destination", "storage_allow_mass_delete"]) {
    const start = workflow.indexOf(`\n      ${input}:\n`);
    assert.ok(start !== -1, `${input} is a dispatch input`);
    assert.match(workflow.slice(start, start + 1400), /type: choice\n\s+options: \[none, staging, production, both\]\n\s+default: none/);
  }
  for (const [job, env] of [["backup-staging-storage", "staging"], ["backup-production-storage", "production"]]) {
    const start = workflow.indexOf(`  ${job}:`);
    const next = workflow.indexOf("\n  backup-", start + 1);
    const block = workflow.slice(start, next === -1 ? undefined : next);
    for (const [param, input] of [["new-destination", "storage_new_destination"], ["allow-mass-delete", "storage_allow_mass_delete"]]) {
      const line = block.split("\n").find((l) => l.trim().startsWith(`${param}:`));
      assert.equal(
        line?.trim(),
        `${param}: \${{ contains(fromJSON('["${env}","both"]'), inputs.${input}) && 'true' || 'false' }}`,
        `${job} ${param}`,
      );
    }
  }

  const action = readFileSync(".github/actions/storage-offsite-backup/action.yml", "utf8");
  assert.match(action, /STORAGE_BACKUP_NEW_DESTINATION: \$\{\{ inputs\.new-destination \}\}/);
  assert.match(action, /STORAGE_BACKUP_ALLOW_MASS_DELETE: \$\{\{ inputs\.allow-mass-delete \}\}/);
});

// -- End to end: the real CLI against a fake R2 and a fake Storage -----------
// The unit tests above prove each check; these prove runBackup acts on them.
// `aws` is a shim on PATH over a temp directory, and Storage is a fetch
// preload, so every run below is `storage-backup-run.mjs` exactly as the
// nightly job invokes it.

const FIXTURES = join(import.meta.dirname, "fixtures", "storage-backup");

function e2eSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "storage-backup-e2e-"));
  const bin = join(dir, "bin");
  const s3 = join(dir, "s3");
  spawnSync("mkdir", ["-p", bin, s3]);
  writeFileSync(join(bin, "aws"), `#!/bin/sh\nexec "${process.execPath}" "${join(FIXTURES, "fake-aws.mjs")}" "$@"\n`);
  chmodSync(join(bin, "aws"), 0o755);
  const run = (mode, storage, env = {}) => {
    const storageFile = join(dir, "storage.json");
    writeFileSync(storageFile, JSON.stringify(storage));
    const res = spawnSync(
      process.execPath,
      ["--import", join(FIXTURES, "fake-storage.mjs"), "scripts/storage-backup-run.mjs", mode, "--prefix", "storage"],
      {
        encoding: "utf8",
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          SUPABASE_URL: "https://hnoyzpidbmizhbqaiity.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "test-key",
          BACKUP_S3_BUCKET: "bk",
          BACKUP_S3_ENDPOINT: "https://r2.example",
          FAKE_S3: s3,
          FAKE_STORAGE: storageFile,
          ...env,
        },
      },
    );
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  };
  const offsite = (key) => join(s3, "bk", key);
  return { run, offsite, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const TWO = { documents: { "chapter-1/a.txt": "hello", "b.txt": "world" }, profiles: {} };

test("e2e: a first backup is refused without the new-destination override, then starts the mirror", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  const refused = box.run("backup", TWO);
  assert.equal(refused.status, 1, refused.out);
  assert.match(refused.out, /No manifest at storage\/manifest\.json/);
  assert.equal(existsSync(box.offsite("storage/manifest.json")), false, "nothing written");

  const started = box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" });
  assert.equal(started.status, 0, started.out);
  const manifest = JSON.parse(readFileSync(box.offsite("storage/manifest.json"), "utf8"));
  assert.equal(manifest.object_count, 2);
  assert.equal(manifest.destination.bucket, "bk");
  assert.equal(manifest.objects.find((o) => o.path === "b.txt").backed_up_bytes, 5);
  assert.equal(box.run("backup", TWO).status, 0, "the next night passes on its own");
  assert.equal(box.run("verify", TWO).status, 0);
});

test("e2e: a listing that comes back empty is refused, and the mirror is left intact", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  const before = readFileSync(box.offsite("storage/manifest.json"), "utf8");
  const empty = box.run("backup", { documents: {}, profiles: {} });
  assert.equal(empty.status, 1, empty.out);
  assert.match(empty.out, /all 2 of 2/);
  assert.equal(readFileSync(box.offsite("storage/manifest.json"), "utf8"), before);
});

test("e2e: a typo'd bucket is refused rather than started as a fresh mirror", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  const typo = box.run("backup", TWO, { BACKUP_S3_BUCKET: "bk-typo" });
  assert.equal(typo.status, 1, typo.out);
  assert.match(typo.out, /No manifest at/);
});

test("e2e: an object R2 lost is re-uploaded, that run fails once, and the next passes", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  unlinkSync(box.offsite("storage/documents/b.txt"));
  const found = box.run("backup", TWO);
  assert.equal(found.status, 1, found.out);
  assert.match(found.out, /not offsite as written/);
  assert.match(found.out, /documents\/b\.txt: not offsite; re-uploaded from Storage/);
  assert.equal(readFileSync(box.offsite("storage/documents/b.txt"), "utf8"), "world");
  assert.equal(box.run("backup", TWO).status, 0, found.out);
});

test("e2e: in CI a loss is reported by bucket, never by object path", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  unlinkSync(box.offsite("storage/documents/chapter-1/a.txt"));
  const found = box.run("backup", TWO, { GITHUB_ACTIONS: "true" });
  assert.equal(found.status, 1, found.out);
  assert.match(found.out, /1 object\(s\) in documents: not offsite/);
  assert.doesNotMatch(found.out, /chapter-1/);
});

test("e2e: verify reports an object missing offsite without writing anything", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  unlinkSync(box.offsite("storage/documents/b.txt"));
  const before = readFileSync(box.offsite("storage/manifest.json"), "utf8");
  const res = box.run("verify", TWO);
  assert.equal(res.status, 1, res.out);
  assert.match(res.out, /documents\/b\.txt: not offsite/);
  assert.equal(readFileSync(box.offsite("storage/manifest.json"), "utf8"), before);
  assert.equal(existsSync(box.offsite("storage/documents/b.txt")), false);
});

test("e2e: a corrupt manifest is refused, and no override gets past it", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  writeFileSync(box.offsite("storage/manifest.json"), "{nope");
  const res = box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" });
  assert.equal(res.status, 1, res.out);
  assert.match(res.out, /is unreadable/);
});

test("e2e: a truncated offsite copy is re-uploaded and reported as a size problem", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  writeFileSync(box.offsite("storage/documents/b.txt"), "");
  const found = box.run("backup", TWO);
  assert.equal(found.status, 1, found.out);
  assert.match(found.out, /documents\/b\.txt: offsite at a different size than was written; re-uploaded from Storage/);
  assert.equal(readFileSync(box.offsite("storage/documents/b.txt"), "utf8"), "world");
  assert.equal(box.run("backup", TWO).status, 0);
});

test("e2e: after a loss, a local verify names what was hit", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  unlinkSync(box.offsite("storage/documents/b.txt"));
  assert.equal(box.run("backup", TWO, { GITHUB_ACTIONS: "true" }).status, 1);
  const res = box.run("verify", TWO);
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /Last offsite loss, found .* \(1 object\(s\)\):\n  - documents\/b\.txt: not offsite; re-uploaded/);
});

test("e2e: verify against a moved bucket refuses without advising an override it ignores", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  const res = box.run("verify", TWO, { BACKUP_S3_BUCKET: "bk-typo", STORAGE_BACKUP_NEW_DESTINATION: "true" });
  assert.equal(res.status, 1, res.out);
  assert.match(res.out, /Check BACKUP_S3_BUCKET/);
  assert.doesNotMatch(res.out, /re-run with STORAGE_BACKUP_NEW_DESTINATION/);
});

test("e2e: a genuine wipe goes through with the override, then empty runs pass with a warning", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  const EMPTY = { documents: {}, profiles: {} };
  const allowed = box.run("backup", EMPTY, { STORAGE_BACKUP_ALLOW_MASS_DELETE: "true" });
  assert.equal(allowed.status, 0, allowed.out);
  const manifest = JSON.parse(readFileSync(box.offsite("storage/manifest.json"), "utf8"));
  assert.equal(manifest.object_count, 0);
  assert.equal(manifest.tombstone_count, 2);
  const after = box.run("backup", EMPTY);
  assert.equal(after.status, 0, after.out);
  assert.match(after.out, /::warning::The mirror holds no live objects/);
});

test("e2e: a mirror that never held an object passes, with a warning", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  const res = box.run("backup", { documents: {}, profiles: {} }, { STORAGE_BACKUP_NEW_DESTINATION: "true" });
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /::warning::The mirror holds no live objects/);
});

test("e2e: in CI a failed download names the bucket, never the object's path", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  const gone = { documents: { "chapter-1/member-file.pdf": null }, profiles: {} };
  const res = box.run("backup", gone, { STORAGE_BACKUP_NEW_DESTINATION: "true", GITHUB_ACTIONS: "true" });
  assert.equal(res.status, 1, res.out);
  assert.match(res.out, /Downloading documents\/<path withheld> failed: HTTP 404/);
  assert.doesNotMatch(res.out, /member-file|chapter-1/);
});

test("e2e (#2916): a run out of budget keeps what it wrote, fails, and the next run finishes the rest", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);

  const MORE = { documents: { "chapter-1/a.txt": "hello", "b.txt": "WORLD!", "c.txt": "new" }, profiles: {} };
  const out = box.run("backup", MORE, { STORAGE_BACKUP_BUDGET_MINUTES: "0" });
  assert.equal(out.status, 1, out.out);
  assert.match(out.out, /budget \(STORAGE_BACKUP_BUDGET_MINUTES\) ran out: uploaded 0 of 2 object\(s\)/);
  const manifest = JSON.parse(readFileSync(box.offsite("storage/manifest.json"), "utf8"));
  assert.deepEqual(manifest.objects.map((o) => o.path).sort(), ["b.txt", "chapter-1/a.txt"], "the new object is not claimed");
  assert.equal(manifest.objects.find((o) => o.path === "b.txt").backed_up_bytes, 5, "the changed one keeps its old record");
  assert.equal(readFileSync(box.offsite("storage/documents/b.txt"), "utf8"), "world", "and its old bytes");
  assert.equal(existsSync(box.offsite("storage/documents/c.txt")), false);

  const rest = box.run("backup", MORE);
  assert.equal(rest.status, 0, rest.out);
  assert.match(rest.out, /Plan: 2 to upload, 1 unchanged/);
  assert.equal(readFileSync(box.offsite("storage/documents/b.txt"), "utf8"), "WORLD!");
  assert.equal(readFileSync(box.offsite("storage/documents/c.txt"), "utf8"), "new");
  assert.equal(box.run("verify", MORE).status, 0);
});

test("e2e: a first mirror out of budget starts empty rather than claiming what it never copied", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  const out = box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true", STORAGE_BACKUP_BUDGET_MINUTES: "0" });
  assert.equal(out.status, 1, out.out);
  assert.doesNotMatch(out.out, /::warning::The mirror holds no live objects/);
  assert.equal(JSON.parse(readFileSync(box.offsite("storage/manifest.json"), "utf8")).object_count, 0);
  const rest = box.run("backup", TWO);
  assert.equal(rest.status, 0, rest.out);
  assert.match(rest.out, /Uploaded 2 object\(s\)/);
});

test("e2e: a budget that isn't a number is refused before anything is written", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  const out = box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true", STORAGE_BACKUP_BUDGET_MINUTES: "forty" });
  assert.equal(out.status, 1, out.out);
  assert.match(out.out, /STORAGE_BACKUP_BUDGET_MINUTES must be a non-negative number, got 'forty'/);
  assert.equal(existsSync(box.offsite("storage/manifest.json")), false);
});

test("e2e (#2916 review): a deferred re-upload of lost bytes is named, alongside the budget, not as a broken mirror", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  unlinkSync(box.offsite("storage/documents/b.txt"));
  const MORE = { documents: { ...TWO.documents, "c.txt": "new" }, profiles: {} };

  const cut = box.run("backup", MORE, { STORAGE_BACKUP_BUDGET_MINUTES: "0" });
  assert.equal(cut.status, 1, cut.out);
  assert.doesNotMatch(cut.out, /does not hold what its manifest lists/);
  assert.match(cut.out, /documents\/b\.txt: not offsite; not re-uploaded yet \(the run stopped first\); the next run will/);
  assert.match(cut.out, /budget \(STORAGE_BACKUP_BUDGET_MINUTES\) ran out: uploaded 0 of 2 object\(s\)/);
  assert.match(cut.out, /\(2 this run didn't reach were not checked\)/);

  // The loss is reported once more by the run that repairs it, then it's over.
  const repair = box.run("backup", MORE);
  assert.equal(repair.status, 1, repair.out);
  assert.match(repair.out, /documents\/b\.txt: not offsite; re-uploaded from Storage/);
  assert.equal(readFileSync(box.offsite("storage/documents/b.txt"), "utf8"), "world");
  assert.equal(box.run("backup", MORE).status, 0);
});

test("e2e (#2916 review): a failed download keeps the rest of the run, and the next run passes", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  // More objects than TRANSFER_CONCURRENCY, the missing one first: every
  // object after the pool's first round starts only if the failure didn't
  // stop the run.
  const rest = Object.fromEntries(Array.from({ length: TRANSFER_CONCURRENCY + 4 }, (_, i) => [`f${String(i).padStart(2, "0")}.txt`, `n${i}`]));
  const withGone = { documents: { "0-gone.txt": null, ...rest }, profiles: {} };
  const res = box.run("backup", withGone, { STORAGE_BACKUP_NEW_DESTINATION: "true" });
  assert.equal(res.status, 1, res.out);
  assert.match(res.out, /1 transfer\(s\) failed\. The rest of the run went ahead/);
  assert.match(res.out, /Downloading documents\/0-gone\.txt failed: HTTP 404/);
  const manifest = JSON.parse(readFileSync(box.offsite("storage/manifest.json"), "utf8"));
  assert.deepEqual(manifest.objects.map((o) => o.path).sort(), Object.keys(rest), "every other object uploaded and is recorded");

  const after = box.run("backup", { documents: rest, profiles: {} });
  assert.equal(after.status, 0, after.out);
  assert.match(after.out, new RegExp(`Plan: 0 to upload, ${Object.keys(rest).length} unchanged`));
});

test("e2e (#2916 review): prunes stop at the budget too, and an unpruned tombstone R2 already lost fails nothing extra", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  assert.equal(box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true" }).status, 0);
  unlinkSync(box.offsite("storage/documents/b.txt"));
  const ONE = { documents: { "chapter-1/a.txt": "hello" }, profiles: {} };

  const cut = box.run("backup", ONE, { STORAGE_BACKUP_BUDGET_MINUTES: "0", BACKUP_RETENTION_DAYS: "0" });
  assert.equal(cut.status, 1, cut.out);
  assert.doesNotMatch(cut.out, /does not hold what its manifest lists/);
  assert.match(cut.out, /pruned 0 of 1/);
  const tomb = JSON.parse(readFileSync(box.offsite("storage/manifest.json"), "utf8")).objects.find((o) => o.path === "b.txt");
  assert.ok(tomb?.deleted_at, "the unpruned record stays as a tombstone");

  const pruned = box.run("backup", ONE, { BACKUP_RETENTION_DAYS: "0" });
  assert.equal(pruned.status, 0, pruned.out);
  const after = JSON.parse(readFileSync(box.offsite("storage/manifest.json"), "utf8"));
  assert.deepEqual(after.objects.map((o) => o.path), ["chapter-1/a.txt"]);
});

test("e2e: a blank budget means the default, not zero", (t) => {
  const box = e2eSandbox();
  t.after(box.cleanup);
  const res = box.run("backup", TWO, { STORAGE_BACKUP_NEW_DESTINATION: "true", STORAGE_BACKUP_BUDGET_MINUTES: "  " });
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /Uploaded 2 object\(s\)/);
});
