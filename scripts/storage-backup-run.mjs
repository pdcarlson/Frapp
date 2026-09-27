#!/usr/bin/env node
//
// CLI for the Storage backup (#1290). The decisions live in
// `scripts/storage-backup.mjs`; this file is the I/O around them.
//
// Three modes, one code path:
//
//   backup   list Storage, upload what changed to the offsite bucket, write the
//            manifest. What the nightly workflow runs.
//   restore  read the offsite copy back INTO Storage. The half that makes the
//            other half a backup rather than a copy.
//   rehearse write a canary, back it up, delete it from Storage, restore it,
//            assert the bytes survived. AC 3 of #1290, as something repeatable
//            rather than a one-time manual chore.
//   verify   read-only: prove the manifest is this destination's and every
//            object it lists is offsite at the size it recorded (presence and
//            length, not a content hash). `backup` runs the same check after
//            every write (#2335); on its own it is what a restore runs first.
//
// The offsite side shells out to `aws s3`, exactly as db-backup.yml does, so
// there is one S3 story in this repo and not two. The AWS_* environment and the
// --endpoint-url flag are what make that work against Cloudflare R2.
//
// Usage:
//   node scripts/storage-backup-run.mjs backup   [--prefix storage] [--dry-run]
//   node scripts/storage-backup-run.mjs restore  [--prefix storage] [--bucket B]
//                                               [--path P] [--dry-run]
//   node scripts/storage-backup-run.mjs rehearse [--prefix storage]
//   node scripts/storage-backup-run.mjs verify   [--prefix storage]

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  DEFAULT_RETENTION_DAYS,
  REHEARSAL_BUCKET,
  REHEARSAL_CONTENT_TYPE,
  REHEARSAL_PREFIX,
  assertManifestDestination,
  assertSafeObjectPath,
  assertStorageBackupTarget,
  backupKey,
  checkDeletionSanity,
  downloadObject,
  isMissingObjectError,
  listBucketObjects,
  listBuckets,
  mirrorDestination,
  offsiteProblem,
  parseOffsiteListing,
  planSync,
  sha256,
  uploadObject,
} from "./storage-backup.mjs";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`::error::${name} is not set. See docs/internal/environment/SECRETS_MANAGEMENT.md.`);
    process.exit(1);
  }
  return v;
}

function aws(args, { endpoint, allowFailure = false } = {}) {
  try {
    return execFileSync("aws", [...args, "--endpoint-url", endpoint], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // Node's default is 1 MiB, and the offsite listing grows with the
      // corpus; past the limit the call dies with ENOBUFS on every run.
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (err) {
    if (allowFailure) return null;
    // stderr, not the thrown object: the AWS CLI puts the actionable message
    // there, and the Error's own message is just the exit code. Kept on the
    // error too, so a caller can tell a missing key from a failed read.
    const failure = new Error(`aws ${args[0]} ${args[1] ?? ""} failed: ${err.stderr || err.message}`);
    failure.stderr = String(err.stderr ?? "");
    throw failure;
  }
}

function parseArgs(argv) {
  const opts = { mode: argv[0], prefix: "storage", dryRun: false, bucket: null, path: null };
  for (let i = 1; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--prefix": opts.prefix = argv[++i]; break;
      case "--bucket": opts.bucket = argv[++i]; break;
      case "--path": opts.path = argv[++i]; break;
      case "--dry-run": opts.dryRun = true; break;
      default:
        console.error(`Unknown argument '${argv[i]}'`);
        process.exit(2);
    }
  }
  return opts;
}

/**
 * The previous manifest, or null when there is none under the prefix.
 *
 * Only a missing key is null. A missing manifest must never mean "everything
 * was deleted" -- that would tombstone the whole backup -- and it no longer
 * means "back everything up" either: the backup refuses it unless the run says
 * the destination is new (`assertManifestDestination`, #2335). A failed read
 * (403, timeout) or a corrupt manifest throws, because treating either as a
 * first run is how a broken destination used to look green.
 */
function readManifest({ bucket, prefix, endpoint, tmp }) {
  const local = join(tmp, "manifest.json");
  try {
    aws(["s3", "cp", `s3://${bucket}/${prefix}/manifest.json`, local, "--only-show-errors"], { endpoint });
  } catch (err) {
    if (isMissingObjectError(err.stderr)) return null;
    throw err;
  }
  try {
    return JSON.parse(readFileSync(local, "utf8"));
  } catch (err) {
    throw new Error(
      `The manifest at ${prefix}/manifest.json is unreadable (${err.message}); refusing to back up over it. ` +
        `No re-run input clears this: see DB_ROLLBACK_PLAYBOOK.md § If the backup job fails.`,
    );
  }
}

/**
 * List the prefix offsite and check it holds every object the manifest names,
 * at the size it recorded. Throws with every problem found.
 */
function listOffsite({ bucket, prefix, endpoint }) {
  return parseOffsiteListing(
    aws(
      [
        "s3api", "list-objects-v2", "--bucket", bucket, "--prefix", `${prefix}/`,
        "--query", "Contents[].[Key,Size]", "--output", "json",
      ],
      { endpoint },
    ),
  );
}

/**
 * Lines naming affected objects, for an error. Object paths carry chapter ids
 * and member-chosen filenames, and this repository's Actions logs are public,
 * so in CI only per-bucket counts are printed; `verify` run locally lists the
 * paths.
 */
function describeObjects(entries) {
  if (process.env.GITHUB_ACTIONS === "true") {
    const perBucket = new Map();
    for (const { record, text } of entries) {
      const key = `${record.bucket}: ${text}`;
      perBucket.set(key, (perBucket.get(key) ?? 0) + 1);
    }
    const lines = [...perBucket].map(([key, n]) => `  - ${n} object(s) in ${key}`).join("\n");
    return `${lines}\n  (Paths are withheld from this public log; run \`verify\` locally to list them.)`;
  }
  const shown = entries.slice(0, 20).map(({ record, text }) => `  - ${record.bucket}/${record.path}: ${text}`).join("\n");
  return entries.length > 20 ? `${shown}\n  ...and ${entries.length - 20} more` : shown;
}

function verifyOffsite({ manifest, bucket, prefix, endpoint }) {
  const listing = listOffsite({ bucket, prefix, endpoint });
  const problems = (manifest?.objects ?? []).map((r) => offsiteProblem(r, prefix, listing)).filter(Boolean);
  if (problems.length > 0) {
    throw new Error(
      `The offsite mirror does not hold what its manifest lists (${problems.length} problem(s)):\n` +
        describeObjects(problems.map((p) => ({ record: p.record, text: PROBLEM_TEXT[p.kind] }))),
    );
  }
  return (manifest?.objects ?? []).filter((o) => !o.lost_offsite_at).length;
}

const PROBLEM_TEXT = { missing: "not offsite", size: "offsite at a different size than was written" };

function expectedDestination(opts, s3Bucket) {
  return mirrorDestination({
    environment: opts.target.environment,
    projectRef: opts.target.projectRef,
    bucket: s3Bucket,
    prefix: opts.prefix,
  });
}

async function collectRemote({ supabaseUrl, serviceKey }) {
  const buckets = await listBuckets({ supabaseUrl, serviceKey });
  console.log(`Buckets: ${buckets.join(", ") || "(none)"}`);

  const remote = [];
  for (const bucket of buckets) {
    const objects = await listBucketObjects({ supabaseUrl, serviceKey, bucket });
    console.log(`  ${bucket}: ${objects.length} object(s)`);
    remote.push(...objects);
  }
  return remote;
}

async function runBackup(opts) {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const s3Bucket = requireEnv("BACKUP_S3_BUCKET");
  const endpoint = requireEnv("BACKUP_S3_ENDPOINT");
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);

  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    console.error(`::error::BACKUP_RETENTION_DAYS must be a non-negative number, got '${process.env.BACKUP_RETENTION_DAYS}'.`);
    process.exit(1);
  }

  const tmp = mkdtempSync(join(tmpdir(), "storage-backup-"));
  try {
    const destination = expectedDestination(opts, s3Bucket);
    const manifest = readManifest({ bucket: s3Bucket, prefix: opts.prefix, endpoint, tmp });
    // Before listing Storage and before any write: a manifest that isn't this
    // destination's means the run is pointed somewhere nobody restores from.
    assertManifestDestination({
      manifest,
      expected: destination,
      allowNewDestination: process.env.STORAGE_BACKUP_NEW_DESTINATION === "true",
    });
    if (manifest === null) {
      console.log("STORAGE_BACKUP_NEW_DESTINATION=true and no manifest offsite -- starting a new mirror.");
    }

    const remote = await collectRemote({ supabaseUrl, serviceKey });
    const plan = planSync({
      remote,
      manifest,
      nowMs: Date.now(),
      retentionMs: retentionDays * 86_400_000,
      destination,
      prefix: opts.prefix,
      // What is offsite now, so an object the manifest lists but R2 lost is
      // copied again instead of being carried forward as "unchanged".
      offsite: manifest === null ? null : listOffsite({ bucket: s3Bucket, prefix: opts.prefix, endpoint }),
    });

    console.log(
      `Plan: ${plan.upload.length} to upload, ${plan.keep.length} unchanged, ` +
        `${plan.tombstone.length} newly deleted, ${plan.prune.length} past retention, ` +
        `${plan.missingOffsite.length} missing offsite.`,
    );

    // Before any write. A short listing looks exactly like a mass deletion from
    // in here, and the difference only becomes visible once retention starts
    // pruning -- by which point the run has looked green for a month.
    const sanity = checkDeletionSanity({ manifest, tombstone: plan.tombstone });
    if (!sanity.ok && process.env.STORAGE_BACKUP_ALLOW_MASS_DELETE !== "true") {
      console.error(`::error::${sanity.reason}`);
      process.exit(1);
    }
    if (!sanity.ok) {
      console.log(`STORAGE_BACKUP_ALLOW_MASS_DELETE=true -- proceeding with ${sanity.deleting} deletions.`);
    }

    if (opts.dryRun) {
      console.log("--dry-run: stopping before any write.");
      return plan;
    }

    // The record of what was actually written, which the offsite check below
    // compares with: Storage's listed `size` can go stale if the object
    // changes between the listing and the download.
    const records = new Map(plan.manifest.objects.map((o) => [`${o.bucket}\u0000${o.path}`, o]));
    let bytes = 0;
    for (const obj of plan.upload) {
      const body = await downloadObject({ supabaseUrl, serviceKey, bucket: obj.bucket, path: obj.path });
      const local = join(tmp, "obj");
      writeFileSync(local, body);
      aws(
        ["s3", "cp", local, `s3://${s3Bucket}/${backupKey(opts.prefix, obj.bucket, obj.path)}`, "--only-show-errors"],
        { endpoint },
      );
      records.get(`${obj.bucket}\u0000${obj.path}`).backed_up_bytes = body.length;
      bytes += body.length;
    }

    for (const obj of plan.prune) {
      aws(["s3", "rm", `s3://${s3Bucket}/${backupKey(opts.prefix, obj.bucket, obj.path)}`, "--only-show-errors"], {
        endpoint,
        allowFailure: true,
      });
    }

    const manifestPath = join(tmp, "manifest.next.json");
    const written = JSON.stringify(plan.manifest, null, 2);
    writeFileSync(manifestPath, written);
    aws(["s3", "cp", manifestPath, `s3://${s3Bucket}/${opts.prefix}/manifest.json`, "--only-show-errors"], { endpoint });

    // Read the manifest straight back. `aws s3 cp` exiting 0 proves the request
    // was accepted, not that the object is retrievable from the bucket you think
    // you configured -- the same read-back db-backup.yml does, for the same
    // reason: an unverified backup is the thing this work exists to end. Byte
    // for byte: comparing `object_count` with itself verified `0 === 0` (#2335).
    const verify = join(tmp, "manifest.verify.json");
    aws(["s3", "cp", `s3://${s3Bucket}/${opts.prefix}/manifest.json`, verify, "--only-show-errors"], { endpoint });
    if (readFileSync(verify, "utf8") !== written) {
      throw new Error("Read-back mismatch: the manifest read back from the bucket differs from the one written.");
    }

    // Then prove the objects themselves are there, not just the index.
    const checked = verifyOffsite({ manifest: plan.manifest, bucket: s3Bucket, prefix: opts.prefix, endpoint });

    console.log(
      `Uploaded ${plan.upload.length} object(s), ${bytes} byte(s). Manifest read back byte for byte; ` +
        `all ${checked} manifest object(s) found offsite at their recorded size.`,
    );
    // The mirror is whole again, but it wasn't: fail this run so the loss is
    // seen. The next run finds nothing missing and passes.
    if (plan.missingOffsite.length > 0) {
      const lines = describeObjects(
        plan.missingOffsite.map((gap) => ({
          record: gap.record,
          text:
            `${PROBLEM_TEXT[gap.kind]}; ` +
            (gap.recovered ? "re-uploaded from Storage" : "deleted from Storage too, so it is unrecoverable"),
        })),
      );
      throw new Error(
        `${plan.missingOffsite.length} object(s) the previous manifest listed were not offsite as written. ` +
          `Something other than this job changed them (an R2 lifecycle rule, a hand deletion). Every one ` +
          `Storage still has is offsite again; the rest are unrecoverable. Find what changed them:\n${lines}`,
      );
    }

    // A run that would take a mirror from live objects to none was refused
    // above (checkDeletionSanity) unless it was allowed. So an empty mirror
    // here either never held an object (production before launch) or was
    // emptied by an allowed run, and from then on further empty runs pass
    // too. A warning rather than a failure that would stay red until launch.
    if (plan.manifest.object_count === 0) {
      console.log(
        "::warning::The mirror holds no live objects because Storage listed none. Expected only while " +
          "the project has no uploads, or after a deletion someone allowed with storage_allow_mass_delete.",
      );
    }
    return plan;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function runRestore(opts) {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const s3Bucket = requireEnv("BACKUP_S3_BUCKET");
  const endpoint = requireEnv("BACKUP_S3_ENDPOINT");

  const tmp = mkdtempSync(join(tmpdir(), "storage-restore-"));
  try {
    const manifest = readManifest({ bucket: s3Bucket, prefix: opts.prefix, endpoint, tmp });
    if (!manifest) {
      console.error("::error::No manifest offsite -- there is nothing to restore from.");
      process.exit(1);
    }

    // Tombstoned objects are restorable ON PURPOSE: recovering a file someone
    // deleted is the most likely reason anyone runs this.
    const matching = manifest.objects.filter(
      (o) => (!opts.bucket || o.bucket === opts.bucket) && (!opts.path || o.path === opts.path),
    );
    // A record marked lost has no bytes offsite; copying it would abort the
    // restore halfway through everything else.
    const targets = matching.filter((o) => !o.lost_offsite_at);
    for (const o of matching.filter((o) => o.lost_offsite_at)) {
      console.log(`  skipping ${o.bucket}/${o.path}: lost offsite since ${o.lost_offsite_at}`);
    }
    if (targets.length === 0) {
      console.error("::error::Nothing in the manifest matches that --bucket/--path.");
      process.exit(1);
    }

    console.log(`Restoring ${targets.length} object(s)${opts.dryRun ? " (dry run)" : ""}.`);
    if (opts.dryRun) {
      for (const o of targets) console.log(`  would restore ${o.bucket}/${o.path}`);
      return;
    }

    for (const obj of targets) {
      assertSafeObjectPath(obj.path);
      const local = join(tmp, "restore", obj.bucket, obj.path);
      mkdirSync(dirname(local), { recursive: true });
      aws(
        ["s3", "cp", `s3://${s3Bucket}/${backupKey(opts.prefix, obj.bucket, obj.path)}`, local, "--only-show-errors"],
        { endpoint },
      );
      await uploadObject({
        supabaseUrl,
        serviceKey,
        bucket: obj.bucket,
        path: obj.path,
        body: readFileSync(local),
        contentType: obj.mime_type,
      });
      console.log(`  restored ${obj.bucket}/${obj.path}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * AC 3 of #1290, automated: delete an object, restore it from the offsite copy,
 * confirm the bytes came back.
 *
 * It writes a canary rather than touching real chapter content -- a rehearsal
 * that risks a member's uploaded file is not a rehearsal anyone will run twice.
 */
async function runRehearsal(opts) {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const path = `${REHEARSAL_PREFIX}/canary-${Date.now()}.txt`;
  const body = Buffer.from(`storage backup rehearsal ${new Date().toISOString()}\n`);
  const want = sha256(body);

  console.log(`1/5 writing canary ${REHEARSAL_BUCKET}/${path}`);
  await uploadObject({
    supabaseUrl,
    serviceKey,
    bucket: REHEARSAL_BUCKET,
    path,
    body,
    contentType: REHEARSAL_CONTENT_TYPE,
  });

  console.log("2/5 backing up");
  await runBackup(opts);

  console.log("3/5 deleting the canary from Storage");
  const del = await fetch(`${supabaseUrl}/storage/v1/object/${REHEARSAL_BUCKET}/${path}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!del.ok) throw new Error(`Deleting the canary failed: HTTP ${del.status}`);

  console.log("4/5 restoring it from the offsite copy");
  await runRestore({ ...opts, bucket: REHEARSAL_BUCKET, path });

  console.log("5/5 verifying the bytes");
  const got = await downloadObject({ supabaseUrl, serviceKey, bucket: REHEARSAL_BUCKET, path });
  if (sha256(got) !== want) {
    throw new Error(`Rehearsal FAILED: restored bytes differ (want ${want}, got ${sha256(got)}).`);
  }

  // Clean up after ourselves. The tombstone stays in the manifest until
  // retention prunes it, which is correct -- it is a real record of a deletion.
  await fetch(`${supabaseUrl}/storage/v1/object/${REHEARSAL_BUCKET}/${path}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });

  console.log("Rehearsal PASSED: an object deleted from Storage was restored from the offsite copy byte-for-byte.");
}

/**
 * Read-only: the manifest is this destination's, and every object it lists is
 * offsite at its recorded size. The same check `backup` runs after writing.
 */
async function runVerify(opts) {
  const s3Bucket = requireEnv("BACKUP_S3_BUCKET");
  const endpoint = requireEnv("BACKUP_S3_ENDPOINT");

  const tmp = mkdtempSync(join(tmpdir(), "storage-verify-"));
  try {
    const manifest = readManifest({ bucket: s3Bucket, prefix: opts.prefix, endpoint, tmp });
    assertManifestDestination({ manifest, expected: expectedDestination(opts, s3Bucket), readOnly: true });
    const checked = verifyOffsite({ manifest, bucket: s3Bucket, prefix: opts.prefix, endpoint });
    const lost = manifest.objects.length - checked;
    console.log(
      `Verified: ${checked} manifest object(s) found offsite at their recorded size ` +
        `(${manifest.object_count} live, ${manifest.tombstone_count} tombstoned` +
        `${lost > 0 ? `, of which ${lost} marked lost` : ""}); manifest generated ${manifest.generated_at}.`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const opts = parseArgs(process.argv.slice(2));
const modes = { backup: runBackup, restore: runRestore, rehearse: runRehearsal, verify: runVerify };
const run = modes[opts.mode];

if (!run) {
  console.error(`Usage: storage-backup-run.mjs <backup|restore|rehearse|verify> [options]`);
  process.exit(2);
}

try {
  // Before any Storage or R2 write. The GHA action used to be the only place
  // that compared SUPABASE_URL to .github/environments.json; a local rehearsal
  // with production credentials would otherwise write a canary into production.
  const target = assertStorageBackupTarget({
    supabaseUrl: process.env.SUPABASE_URL,
    prefix: opts.prefix,
    mode: opts.mode,
    expectedEnvironment: process.env.BACKUP_ENVIRONMENT || undefined,
  });
  console.log(`Target: ${target.environment} (${target.projectRef}) prefix '${opts.prefix}'.`);
  opts.target = target;
} catch (err) {
  console.error(`::error::${err.message}`);
  process.exit(1);
}

run(opts).catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});
