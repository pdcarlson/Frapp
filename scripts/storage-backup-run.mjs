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

import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_BUDGET_MINUTES,
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
  knownGapIds,
  listBucketObjects,
  MAX_TRANSFER_FAILURES,
  listBuckets,
  mirrorDestination,
  objectId,
  parseOffsiteListing,
  planSync,
  runPool,
  settleManifest,
  sha256,
  stillListed,
  TRANSFER_CONCURRENCY,
  uploadObject,
  uploadOrder,
  verifyOffsiteMirror,
} from "./storage-backup.mjs";

const execFileAsync = promisify(execFile);

// Throws rather than exiting, like every refusal inside a mode: the rehearsal
// cleans up its canary on a thrown error, and `process.exit` skips that.
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. See docs/internal/environment/SECRETS_MANAGEMENT.md.`);
  return v;
}

const AWS_EXEC_OPTIONS = {
  encoding: "utf8",
  // Node's default is 1 MiB, and the offsite listing grows with the
  // corpus; past the limit the call dies with ENOBUFS on every run.
  maxBuffer: 512 * 1024 * 1024,
};

// stderr, not the thrown object: the AWS CLI puts the actionable message
// there, and the Error's own message is just the exit code. Kept on the
// error too, so a caller can tell a missing key from a failed read.
function awsFailure(args, err) {
  const failure = new Error(`aws ${args[0]} ${args[1] ?? ""} failed: ${err.stderr || err.message}`);
  failure.stderr = String(err.stderr ?? "");
  return failure;
}

function aws(args, { endpoint, allowFailure = false } = {}) {
  try {
    return execFileSync("aws", [...args, "--endpoint-url", endpoint], { ...AWS_EXEC_OPTIONS, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (allowFailure) return null;
    throw awsFailure(args, err);
  }
}

/** `aws` without blocking the event loop, so the transfer pool can overlap calls. */
async function awsAsync(args, { endpoint, allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync("aws", [...args, "--endpoint-url", endpoint], AWS_EXEC_OPTIONS);
    return stdout;
  } catch (err) {
    if (allowFailure) return null;
    throw awsFailure(args, err);
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
        `No re-run input clears this: see db-rollback-playbook.md § If the backup job fails.`,
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
 * An error about one object, safe for a public CI log: the object's path
 * (and the folder, for a listing) is replaced, since it carries chapter ids
 * and member-chosen filenames. Locally the error passes through unchanged.
 */
function withheld(err, ...paths) {
  if (process.env.GITHUB_ACTIONS !== "true") return err;
  let message = err.message;
  for (const p of paths.filter(Boolean)) message = message.split(p).join("<path withheld>");
  return new Error(message);
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
  const problems = verifyOffsiteMirror({ manifest, prefix, listing });
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
    let objects;
    try {
      objects = await listBucketObjects({ supabaseUrl, serviceKey, bucket });
    } catch (err) {
      // "Listing <bucket>/<folder> failed": the folder is a chapter's.
      throw withheld(err, ...(err.message.match(new RegExp(`^Listing ${bucket}/(.+) failed`))?.slice(1) ?? []));
    }
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
  // `||` would read an explicit 0 as unset; 0 is a real budget (start nothing).
  // Blank is unset, though: Number(" ") is 0, not NaN.
  const budgetRaw = process.env.STORAGE_BACKUP_BUDGET_MINUTES;
  const budgetMinutes = (budgetRaw ?? "").trim() === "" ? DEFAULT_BUDGET_MINUTES : Number(budgetRaw);

  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    throw new Error(`BACKUP_RETENTION_DAYS must be a non-negative number, got '${process.env.BACKUP_RETENTION_DAYS}'.`);
  }
  if (!Number.isFinite(budgetMinutes) || budgetMinutes < 0) {
    throw new Error(`STORAGE_BACKUP_BUDGET_MINUTES must be a non-negative number, got '${budgetRaw}'.`);
  }
  // From process start, not from here: the listings spend the same job timeout.
  const overBudget = () => process.uptime() >= budgetMinutes * 60;

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
      throw new Error(sanity.reason);
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
    const records = new Map(plan.manifest.objects.map((o) => [objectId(o), o]));
    let bytes = 0;
    // Deleted from Storage after the listing (`stillListed`): nothing to copy,
    // and the next listing records the deletion. Not a failure, or every busy
    // night is red.
    const vanished = new Set();
    // Failures are shared across both pools, so the cap is on the run. A pool
    // handed a cap of zero or less starts nothing.
    const transferFailures = [];
    const pool = () => ({
      limit: TRANSFER_CONCURRENCY,
      shouldStop: overBudget,
      maxFailures: MAX_TRANSFER_FAILURES - transferFailures.length,
    });
    const uploadRun = await runPool(uploadOrder(plan), pool(), async (obj, slot) => {
      let body;
      try {
        body = await downloadObject({ supabaseUrl, serviceKey, bucket: obj.bucket, path: obj.path });
      } catch (err) {
        // A listing that fails too counts as "still listed": the download
        // failure is reported rather than assumed away.
        const listed = await stillListed({ supabaseUrl, serviceKey, bucket: obj.bucket, path: obj.path }).catch(() => true);
        if (!listed) {
          vanished.add(objectId(obj));
          return;
        }
        throw withheld(err, obj.path, encodeURIComponent(obj.path));
      }
      const scratch = join(tmp, `obj-${slot}`);
      try {
        writeFileSync(scratch, body);
        await awsAsync(
          ["s3", "cp", scratch, `s3://${s3Bucket}/${backupKey(opts.prefix, obj.bucket, obj.path)}`, "--only-show-errors"],
          { endpoint },
        );
      } catch (err) {
        throw withheld(err, obj.path, encodeURIComponent(obj.path));
      }
      records.get(objectId(obj)).backed_up_bytes = body.length;
      bytes += body.length;
    });
    transferFailures.push(...uploadRun.failures);

    // No `allowFailure`: deleting a key that is already gone succeeds, so a
    // failed `rm` is a real failure, and its tombstone must stay for a retry.
    const pruneRun = await runPool(plan.prune, pool(), (obj) =>
      awsAsync(["s3", "rm", `s3://${s3Bucket}/${backupKey(opts.prefix, obj.bucket, obj.path)}`, "--only-show-errors"], {
        endpoint,
      }).catch((err) => {
        throw withheld(err, obj.path, encodeURIComponent(obj.path));
      }),
    );
    transferFailures.push(...pruneRun.failures);
    // Why the pools stopped, decided now: the budget and the cap are the only
    // two reasons a pool leaves work unstarted.
    const stoppedBy = transferFailures.length >= MAX_TRANSFER_FAILURES ? "cap" : "budget";

    const uploaded = new Set(uploadRun.done.map(objectId).filter((id) => !vanished.has(id)));
    const pruned = new Set(pruneRun.done.map(objectId));
    const failed = new Set(transferFailures.map(({ item }) => objectId(item)));
    const notStarted = new Set(
      [...plan.upload, ...plan.prune].map(objectId).filter((id) => !uploaded.has(id) && !pruned.has(id) && !vanished.has(id) && !failed.has(id)),
    );
    const next = settleManifest({ plan, previous: manifest, uploaded, pruned, deferred: notStarted, vanished });

    const manifestPath = join(tmp, "manifest.next.json");
    const written = JSON.stringify(next, null, 2);
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

    if (vanished.size > 0) {
      console.log(`${vanished.size} object(s) were deleted from Storage after the listing; the next run records them as deleted.`);
    }

    // Every failure below is collected, not thrown on the spot, so a run that
    // stopped early, lost objects and failed transfers says all of it at once.
    const failures = [];
    if (transferFailures.length > 0) {
      // Already `withheld` per object; one line each, capped like the loss list.
      const shown = transferFailures.slice(0, 5).map(({ error }) => `  - ${error.message}`).join("\n");
      const more = transferFailures.length > 5 ? `\n  ...and ${transferFailures.length - 5} more` : "";
      failures.push(
        `${transferFailures.length} transfer(s) failed` +
          (stoppedBy === "cap"
            ? `, which reached MAX_TRANSFER_FAILURES, so the run started no more.`
            : notStarted.size === 0
              ? `. The rest of the run went ahead.`
              : ".") +
          ` The next run retries them:\n${shown}${more}`,
      );
    }

    // Then prove the objects themselves are there, not just the index. Known
    // gaps (knownGapIds) are left out: they are named below instead of
    // being reported as a broken mirror.
    const gaps = knownGapIds({ plan, uploaded, pruned });
    try {
      const checked = verifyOffsite({
        manifest: { ...next, objects: next.objects.filter((o) => !gaps.has(objectId(o))) },
        bucket: s3Bucket,
        prefix: opts.prefix,
        endpoint,
      });
      console.log(
        `Uploaded ${uploaded.size} object(s), ${bytes} byte(s). Manifest read back byte for byte; ` +
          `all ${checked} manifest object(s) found offsite, at the written size where recorded` +
          (gaps.size > 0 ? ` (${gaps.size} known gap(s), named below, not re-checked).` : "."),
      );
    } catch (err) {
      failures.push(err.message);
    }

    // The mirror is whole again, but it wasn't: fail this run so the loss is
    // seen. The next run finds nothing missing and passes.
    if (plan.missingOffsite.length > 0) {
      const state = (gap) => {
        const id = objectId(gap.record);
        if (!gap.recovered || vanished.has(id)) return "deleted from Storage too, so it is unrecoverable";
        if (uploaded.has(id)) return "re-uploaded from Storage";
        if (failed.has(id)) return "re-upload failed (listed above); the next run retries it";
        return "not re-uploaded yet (the run stopped first); the next run will";
      };
      const lines = describeObjects(
        plan.missingOffsite.map((gap) => ({ record: gap.record, text: `${PROBLEM_TEXT[gap.kind]}; ${state(gap)}` })),
      );
      failures.push(
        `${plan.missingOffsite.length} object(s) the previous manifest listed were not offsite as written. ` +
          `Something other than this job changed them (an R2 lifecycle rule, a hand deletion). Each one's ` +
          `state is below. The manifest records which ` +
          `(last_offsite_loss; \`verify\` prints it). Find what changed them:\n${lines}`,
      );
    }
    // Progress is kept, the gap is not hidden: the manifest holds what was
    // written, and the run fails so a mirror that is behind never looks green.
    const leftUploads = plan.upload.filter((o) => notStarted.has(objectId(o))).length;
    const leftPrunes = plan.prune.filter((o) => notStarted.has(objectId(o))).length;
    if (leftUploads > 0 || leftPrunes > 0) {
      const why =
        stoppedBy === "cap"
          ? "The run reached MAX_TRANSFER_FAILURES and stopped"
          : `The ${budgetMinutes}-minute budget (STORAGE_BACKUP_BUDGET_MINUTES) ran out`;
      failures.push(
        `${why}: uploaded ${uploaded.size} of ${plan.upload.length} object(s) and pruned ${pruned.size} of ` +
          `${plan.prune.length}. The manifest records only what was written, so the next run starts with the ` +
          `${leftUploads} upload(s) and ${leftPrunes} prune(s) never started. Re-run the workflow to continue now.`,
      );
    }
    if (failures.length > 0) throw new Error(failures.join("\n\n"));

    // A run that would take a mirror from live objects to none was refused
    // above (checkDeletionSanity) unless it was allowed. So an empty mirror
    // here either never held an object (production before launch) or was
    // emptied by an allowed run, and from then on further empty runs pass
    // too. A warning rather than a failure that would stay red until launch.
    if (next.object_count === 0) {
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
    if (!manifest) throw new Error("No manifest offsite -- there is nothing to restore from.");

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
    if (targets.length === 0) throw new Error("Nothing in the manifest matches that --bucket/--path.");

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

  const deleteCanary = () =>
    fetch(`${supabaseUrl}/storage/v1/object/${REHEARSAL_BUCKET}/${path}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });

  // Whatever fails from here on, the canary must not stay in live Storage: the
  // rehearsal promises to delete what it wrote, and the next backup would
  // mirror it as a real object. If it was backed up, the next run tombstones it
  // like any delete, and the tombstone stays until retention prunes it, which
  // is correct: it is a real record of a deletion.
  try {
    console.log("2/5 backing up");
    await runBackup(opts);

    console.log("3/5 deleting the canary from Storage");
    const del = await deleteCanary();
    if (!del.ok) throw new Error(`Deleting the canary failed: HTTP ${del.status}`);

    console.log("4/5 restoring it from the offsite copy");
    await runRestore({ ...opts, bucket: REHEARSAL_BUCKET, path });

    console.log("5/5 verifying the bytes");
    const got = await downloadObject({ supabaseUrl, serviceKey, bucket: REHEARSAL_BUCKET, path });
    if (sha256(got) !== want) {
      throw new Error(`Rehearsal FAILED: restored bytes differ (want ${want}, got ${sha256(got)}).`);
    }
  } finally {
    // Gone already (a failure between steps 3 and 4) is fine; anything else
    // means a canary may be left behind, which is worth a line either way.
    const res = await deleteCanary().catch((err) => ({ ok: false, status: err.message }));
    if (!res.ok && res.status !== 404 && res.status !== 400) {
      console.log(`::warning::Deleting the canary ${REHEARSAL_BUCKET}/${path} failed (${res.status}); delete it by hand.`);
    }
  }

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
    // The last loss first: after a failed run it says what was hit, and the
    // check below throws while a gap stands.
    const loss = manifest.last_offsite_loss;
    if (loss) {
      console.log(`Last offsite loss, found ${loss.found_at} (${loss.objects.length} object(s)):`);
      console.log(
        describeObjects(
          loss.objects.map((o) => ({
            record: o,
            text: `${PROBLEM_TEXT[o.kind]}; ${o.recovered ? "re-uploaded" : o.deferred ? "not re-uploaded yet (the run stopped first)" : o.failed ? "re-upload failed; the next run retries it" : "unrecoverable"}`,
          })),
        ),
      );
    }
    const checked = verifyOffsite({ manifest, bucket: s3Bucket, prefix: opts.prefix, endpoint });
    const lost = manifest.objects.length - checked;
    console.log(
      `Verified: ${checked} manifest object(s) found offsite, at the written size where recorded ` +
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
