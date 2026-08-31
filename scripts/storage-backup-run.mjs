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

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  DEFAULT_RETENTION_DAYS,
  backupKey,
  checkDeletionSanity,
  downloadObject,
  listBucketObjects,
  listBuckets,
  planSync,
  sha256,
  uploadObject,
} from "./storage-backup.mjs";

const REHEARSAL_BUCKET = "reports";
const REHEARSAL_PREFIX = "_backup-rehearsal";

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
    });
  } catch (err) {
    if (allowFailure) return null;
    // stderr, not the thrown object: the AWS CLI puts the actionable message
    // there, and the Error's own message is just the exit code.
    throw new Error(`aws ${args[0]} ${args[1] ?? ""} failed: ${err.stderr || err.message}`);
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
 * The previous manifest, or null on a first run.
 *
 * A missing manifest must mean "back everything up", never "everything was
 * deleted" -- so a failed read returns null and the caller treats every object
 * as new. Getting this backwards would tombstone the entire backup on a
 * transient S3 hiccup.
 */
function readManifest({ bucket, prefix, endpoint, tmp }) {
  const local = join(tmp, "manifest.json");
  const got = aws(["s3", "cp", `s3://${bucket}/${prefix}/manifest.json`, local, "--only-show-errors"], {
    endpoint,
    allowFailure: true,
  });
  if (got === null) {
    console.log("No previous manifest offsite -- treating this as a first full backup.");
    return null;
  }
  try {
    return JSON.parse(readFileSync(local, "utf8"));
  } catch (err) {
    // A corrupt manifest is NOT a reason to re-tombstone everything either.
    console.log(`Previous manifest unreadable (${err.message}) -- treating as a first full backup.`);
    return null;
  }
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
    const remote = await collectRemote({ supabaseUrl, serviceKey });
    const manifest = readManifest({ bucket: s3Bucket, prefix: opts.prefix, endpoint, tmp });

    const plan = planSync({
      remote,
      manifest,
      nowMs: Date.now(),
      retentionMs: retentionDays * 86_400_000,
    });

    console.log(
      `Plan: ${plan.upload.length} to upload, ${plan.keep.length} unchanged, ` +
        `${plan.tombstone.length} newly deleted, ${plan.prune.length} past retention.`,
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

    let bytes = 0;
    for (const obj of plan.upload) {
      const body = await downloadObject({ supabaseUrl, serviceKey, bucket: obj.bucket, path: obj.path });
      const local = join(tmp, "obj");
      writeFileSync(local, body);
      aws(
        ["s3", "cp", local, `s3://${s3Bucket}/${backupKey(opts.prefix, obj.bucket, obj.path)}`, "--only-show-errors"],
        { endpoint },
      );
      bytes += body.length;
    }

    for (const obj of plan.prune) {
      aws(["s3", "rm", `s3://${s3Bucket}/${backupKey(opts.prefix, obj.bucket, obj.path)}`, "--only-show-errors"], {
        endpoint,
        allowFailure: true,
      });
    }

    const manifestPath = join(tmp, "manifest.next.json");
    writeFileSync(manifestPath, JSON.stringify(plan.manifest, null, 2));
    aws(["s3", "cp", manifestPath, `s3://${s3Bucket}/${opts.prefix}/manifest.json`, "--only-show-errors"], { endpoint });

    // Read the manifest straight back. `aws s3 cp` exiting 0 proves the request
    // was accepted, not that the object is retrievable from the bucket you think
    // you configured -- the same read-back db-backup.yml does, for the same
    // reason: an unverified backup is the thing this work exists to end.
    const verify = join(tmp, "manifest.verify.json");
    aws(["s3", "cp", `s3://${s3Bucket}/${opts.prefix}/manifest.json`, verify, "--only-show-errors"], { endpoint });
    const readBack = JSON.parse(readFileSync(verify, "utf8"));
    if (readBack.object_count !== plan.manifest.object_count) {
      throw new Error(
        `Read-back mismatch: wrote ${plan.manifest.object_count} objects, read ${readBack.object_count}.`,
      );
    }

    console.log(`Uploaded ${plan.upload.length} object(s), ${bytes} byte(s). Read-back verified.`);
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
    const targets = manifest.objects.filter(
      (o) => (!opts.bucket || o.bucket === opts.bucket) && (!opts.path || o.path === opts.path),
    );
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
    contentType: "text/plain",
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

const opts = parseArgs(process.argv.slice(2));
const modes = { backup: runBackup, restore: runRestore, rehearse: runRehearsal };
const run = modes[opts.mode];

if (!run) {
  console.error(`Usage: storage-backup-run.mjs <backup|restore|rehearse> [options]`);
  process.exit(2);
}

run(opts).catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});
