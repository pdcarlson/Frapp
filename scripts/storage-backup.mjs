#!/usr/bin/env node
//
// Offsite backup of Supabase Storage OBJECTS (#1290).
//
// -- Why this is separate from scripts/db-backup.sh --------------------------
// #852 ships a nightly logical dump of the database. It does not, and by
// construction cannot, cover Storage. Per Supabase: "Database backups do not
// include objects you store via the Storage API, as the database only includes
// metadata about these objects."
// https://supabase.com/docs/guides/platform/backups
//
// So a restore from db-backup alone yields rows pointing at files that were
// never captured. `db-backup.sh` deliberately drops the `storage` schema for a
// related reason -- bucket rows come from our own migrations, and object
// metadata without the objects is worse than nothing. This script is the other
// half of the recovery story, not a flag on the existing one.
//
// -- Why the Storage REST API and not the S3 protocol ------------------------
// The obvious route is `aws s3 sync` against Supabase's S3-compatible endpoint.
// It was rejected on a credential fact, not on taste. Supabase offers exactly
// two ways onto that endpoint
// (https://supabase.com/docs/guides/storage/s3/authentication):
//
//   1. S3 access keys generated in the dashboard. Dashboard-only, so a human
//      step, and this project has no such key in any environment.
//   2. A session token carrying a user JWT -- explicitly "limited access via
//      Row Level Security". `storage.objects` has RLS on with no permissive
//      policies, so an anon JWT reads nothing.
//
// Taking that route would have blocked this work behind a new human-provisioned
// credential. The Storage REST API needs none: SUPABASE_SERVICE_ROLE_KEY is
// already an Infisical staging secret, already injected into the backup
// workflow, and it bypasses RLS. It is the same interface the API itself uses
// (apps/api/src/infrastructure/storage/supabase-storage.service.ts).
//
// -- Mirror, not snapshots ---------------------------------------------------
// db-backup writes a dated snapshot per night because a database dump is one
// atomic artifact. Storage is many independent objects, so this mirrors
// instead: every object lands at a stable key `<prefix>/<bucket>/<path>`, and a
// manifest records what is there. A run uploads only what changed -- which is
// what `aws s3 sync` would have given for free, and what matters when
// `chat-archive` permits 100 MB per object (#1235).
//
// A pure mirror would delete a backup object the moment it left Supabase, which
// would make "delete a file, restore it" impossible -- the exact drill this
// backup exists for. So deletions are TOMBSTONED: the object stays in the
// bucket, the manifest records `deleted_at`, and it is pruned only after the
// retention window. That window is the recovery window.
//
// Env inputs:
//   SUPABASE_URL                  required, e.g. https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY     required, bypasses RLS -- never log it
//   BACKUP_RETENTION_DAYS         optional, default 30
//   BACKUP_ENVIRONMENT            optional; when set, must match the prefix
//                                 (`staging` ↔ `storage`, `production` ↔
//                                 `storage-production`)
//   STORAGE_BACKUP_ALLOW_PRODUCTION_REHEARSAL
//                                 optional; a rehearsal against production is
//                                 refused without this. The nightly production
//                                 job hard-codes rehearsal: false because it
//                                 has no reviewer and the rehearsal writes.
//   STORAGE_BACKUP_ALLOW_PRODUCTION_RESTORE
//                                 optional; a restore against production is
//                                 refused without this. Backup is not: the
//                                 nightly job must read production Storage.
//                                 Restore overwrites live objects.

import { createHash } from "node:crypto";

import { getEnvironment, SUPABASE_PROJECT_REF_PATTERN } from "./ci/lib/environments.mjs";

/** R2 prefix each environment's Storage mirror lives under. The inverse of
 *  `environmentForStoragePrefix`. Staging keeps the pre-existing `storage` so
 *  its history stays continuous; production uses a sibling so neither
 *  environment's manifest can overwrite the other's. */
export const STORAGE_BACKUP_PREFIXES = {
  staging: "storage",
  production: "storage-production",
};

export const DEFAULT_RETENTION_DAYS = 30;

// The rehearsal writes a canary object. Both constants are load-bearing and are
// exported so a test can hold them against the bucket's real declaration.
//
// `documents` rather than `reports` because every bucket in this project pins
// `allowed_mime_types`, and `reports` permits ONLY application/pdf -- a
// text/plain canary there is rejected with a 400 and the rehearsal fails every
// time, for a reason that has nothing to do with the backup. `documents` is the
// one bucket whose list carries text/plain. Do not "tidy" this back to reports.
export const REHEARSAL_BUCKET = "documents";
export const REHEARSAL_CONTENT_TYPE = "text/plain";
export const REHEARSAL_PREFIX = "_backup-rehearsal";

/**
 * Reject an object path that would escape its directory when written locally
 * during a restore. Storage object names are attacker-influenced -- a member
 * chooses the filename they upload -- and a restore turns each one into a local
 * path, so `..` has to be refused rather than trusted.
 */
export function assertSafeObjectPath(path) {
  const segments = String(path).split("/");
  if (segments.some((seg) => seg === ".." || seg === "." || seg === "")) {
    throw new Error(`Refusing unsafe object path '${path}'.`);
  }
  return path;
}
export const LIST_PAGE_SIZE = 100;

// -- Pure planning core ------------------------------------------------------
// Split out from every network call so the decisions that matter -- what to
// upload, what to tombstone, what to prune -- are unit-testable without a
// Supabase or an S3 in the loop.

/**
 * The backup key for an object. Bucket first so a restore can scope to one
 * bucket with a prefix query, and so two buckets holding `avatar.png` cannot
 * collide.
 */
export function backupKey(prefix, bucket, path) {
  return `${prefix}/${bucket}/${path}`;
}

/**
 * Has this object changed since the manifest recorded it?
 *
 * etag first: it is Storage's content hash, so it catches a same-size edit that
 * a size comparison would wave through. `updated_at` alone is not enough either
 * -- a re-upload of identical bytes bumps it, and re-downloading a 100 MB
 * archive because its timestamp moved is exactly the waste this avoids.
 * Missing etag on either side falls back to size + updated_at, which is weaker
 * but never silently wrong: it errs toward re-uploading.
 */
export function isUnchanged(remote, recorded) {
  if (!recorded || recorded.deleted_at) return false;
  if (remote.etag && recorded.etag) return remote.etag === recorded.etag;
  return remote.size === recorded.size && remote.updated_at === recorded.updated_at;
}

/**
 * Decide a run from the live object listing and the previous manifest.
 *
 * Returns:
 *   upload    -- new or changed, must be fetched from Storage and written offsite
 *   tombstone -- gone from Storage, still in the backup, newly marked deleted
 *   prune     -- tombstoned longer than the retention window, safe to delete
 *   keep      -- unchanged, deliberately not re-fetched
 *   manifest  -- the next manifest, whatever the caller does with the above
 *
 * `nowMs` and `retentionMs` are parameters rather than clock reads so the
 * retention boundary is testable at all.
 */
export function planSync({ remote, manifest, nowMs, retentionMs }) {
  const previous = new Map((manifest?.objects ?? []).map((o) => [`${o.bucket}\u0000${o.path}`, o]));
  const seen = new Set();

  const upload = [];
  const keep = [];
  const tombstone = [];
  const prune = [];
  const objects = [];

  for (const obj of remote) {
    const id = `${obj.bucket}\u0000${obj.path}`;
    seen.add(id);
    const recorded = previous.get(id);

    if (isUnchanged(obj, recorded)) {
      keep.push(obj);
      // Carry the record forward verbatim. Rebuilding it from `obj` would drop
      // first_backed_up_at, which is the only record of how far back a given
      // object's copy actually reaches.
      objects.push(recorded);
      continue;
    }

    upload.push(obj);
    objects.push({
      bucket: obj.bucket,
      path: obj.path,
      size: obj.size ?? null,
      etag: obj.etag ?? null,
      updated_at: obj.updated_at ?? null,
      mime_type: obj.mime_type ?? null,
      first_backed_up_at: recorded?.first_backed_up_at ?? new Date(nowMs).toISOString(),
      backed_up_at: new Date(nowMs).toISOString(),
      deleted_at: null,
    });
  }

  // Anything the manifest knows about that Storage no longer lists.
  for (const [id, recorded] of previous) {
    if (seen.has(id)) continue;

    const deletedAt = recorded.deleted_at ?? new Date(nowMs).toISOString();
    const age = nowMs - Date.parse(deletedAt);

    // `>=` so a retention of 0 prunes immediately rather than off-by-one-ing
    // into an extra day. Guard NaN: an unparseable deleted_at must never be
    // read as "infinitely old" and trigger a delete.
    if (Number.isFinite(age) && age >= retentionMs) {
      prune.push(recorded);
      continue;
    }

    if (!recorded.deleted_at) tombstone.push({ ...recorded, deleted_at: deletedAt });
    objects.push({ ...recorded, deleted_at: deletedAt });
  }

  return {
    upload,
    keep,
    tombstone,
    prune,
    manifest: {
      version: 1,
      generated_at: new Date(nowMs).toISOString(),
      retention_days: retentionMs / 86_400_000,
      object_count: objects.filter((o) => !o.deleted_at).length,
      tombstone_count: objects.filter((o) => o.deleted_at).length,
      objects,
    },
  };
}

/**
 * Refuse a run that would tombstone an implausible share of the corpus.
 *
 * Tombstoning is driven entirely by absence: an object the listing does not
 * mention is treated as deleted. That is correct for a real deletion and
 * catastrophic for a listing that came back short -- a permissions change, a
 * renamed bucket, a partial API failure that still returned 200. Tombstones are
 * not immediately destructive (the bytes stay in R2 until retention prunes
 * them), so this is not the last line of defence; it is the one that makes the
 * problem loud on day one instead of on day thirty.
 *
 * `minCorpus` keeps the guard away from the small-corpus case where a large
 * PERCENTAGE is unremarkable -- deleting 2 of 3 objects is 67% and entirely
 * ordinary. A first run has no manifest and so cannot trip this at all.
 */
export function checkDeletionSanity({ manifest, tombstone, maxRatio = 0.5, minCorpus = 20 }) {
  const live = (manifest?.objects ?? []).filter((o) => !o.deleted_at).length;
  if (live < minCorpus) return { ok: true, live, deleting: tombstone.length, ratio: 0 };

  const ratio = tombstone.length / live;
  if (ratio <= maxRatio) return { ok: true, live, deleting: tombstone.length, ratio };

  return {
    ok: false,
    live,
    deleting: tombstone.length,
    ratio,
    reason:
      `This run would mark ${tombstone.length} of ${live} backed-up objects deleted ` +
      `(${Math.round(ratio * 100)}%). That is more likely a short listing than a real ` +
      `mass deletion. Nothing has been changed offsite. If the deletion is genuine, ` +
      `re-run with STORAGE_BACKUP_ALLOW_MASS_DELETE=true.`,
  };
}

/**
 * Which environment a Storage backup prefix claims to hold.
 *
 * `storage` is staging; `storage-production` is production. Anything else is
 * unknown — a local `--prefix tmp` would otherwise write a canary into whichever
 * project `SUPABASE_URL` names and label the mirror as if it were staging.
 */
export function environmentForStoragePrefix(prefix) {
  for (const [name, known] of Object.entries(STORAGE_BACKUP_PREFIXES)) {
    if (known === prefix) return name;
  }
  return null;
}

/**
 * The Supabase project ref named by `SUPABASE_URL`.
 *
 * Only `{ref}.supabase.co` (and `.supabase.net`) hosts are accepted. A local
 * stack URL (`http://127.0.0.1:54321`) must not be read as a truncated ref —
 * the first DNS label of `127.0.0.1` is `127`, which would fail the later
 * environments.json comparison with a confusing message instead of "this is
 * not a hosted project".
 */
export function projectRefFromSupabaseUrl(supabaseUrl) {
  if (typeof supabaseUrl !== "string" || supabaseUrl.trim() === "") {
    throw new Error(
      "SUPABASE_URL is missing; refusing to run a Storage backup against an unnamed project.",
    );
  }

  let url;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error(
      "SUPABASE_URL is not a valid URL; refusing to run a Storage backup against an unnamed project.",
    );
  }

  const host = url.hostname;
  if (!host.endsWith(".supabase.co") && !host.endsWith(".supabase.net")) {
    throw new Error(
      `SUPABASE_URL host '${host}' is not a hosted Supabase project. ` +
        `Storage backup refuses local and unknown hosts so a rehearsal cannot write a canary to the wrong place.`,
    );
  }
  // Hosted projects only over TLS. The service-role key travels on this origin;
  // an `http://<ref>.supabase.co` URL would otherwise pass the host check and
  // send it in the clear. Local-stack URLs already failed the host check above,
  // so this does not change that error.
  if (url.protocol !== "https:") {
    throw new Error(
      `SUPABASE_URL uses ${url.protocol} rather than https:. The service-role key travels on this ` +
        `origin; refusing an unencrypted Storage backup target.`,
    );
  }

  const ref = host.split(".")[0];
  if (!SUPABASE_PROJECT_REF_PATTERN.test(ref)) {
    throw new Error(
      `SUPABASE_URL host '${host}' does not start with a 15-20 character project ref; refusing.`,
    );
  }
  return ref;
}

/**
 * Fail closed before any Storage or R2 write.
 *
 * The GHA action used to parse the hostname in bash and compare it to
 * `inputs.environment`. The CLI did not, so a local
 * `rehearse --prefix storage` against production `SUPABASE_URL` would write a
 * canary into production Storage. One function now is that fence for both.
 *
 * Invariants:
 *   - prefix `storage` ↔ staging ref in `.github/environments.json`
 *   - prefix `storage-production` ↔ production ref
 *   - an unknown prefix is refused, not treated as a scratch namespace
 *   - `expectedEnvironment` (GHA `inputs.environment` / `BACKUP_ENVIRONMENT`)
 *     must match the prefix when set
 *   - `rehearse` against production is refused unless
 *     `STORAGE_BACKUP_ALLOW_PRODUCTION_REHEARSAL=true`
 *   - `restore` against production is refused unless
 *     `STORAGE_BACKUP_ALLOW_PRODUCTION_RESTORE=true` (backup stays allowed:
 *     the nightly job must read production Storage)
 */
export function assertStorageBackupTarget({
  supabaseUrl,
  prefix,
  mode,
  expectedEnvironment,
  allowProductionRehearsal,
  allowProductionRestore,
  lookupEnvironment = getEnvironment,
} = {}) {
  const envFromPrefix = environmentForStoragePrefix(prefix);
  if (!envFromPrefix) {
    const known = Object.entries(STORAGE_BACKUP_PREFIXES)
      .map(([name, p]) => `${p} (${name})`)
      .join(", ");
    throw new Error(
      `Unknown Storage backup prefix '${prefix}'. Known: ${known}. ` +
        `A run with an unrecognised prefix would mislabel the mirror; refusing.`,
    );
  }

  if (expectedEnvironment && expectedEnvironment !== envFromPrefix) {
    throw new Error(
      `Storage prefix '${prefix}' belongs to ${envFromPrefix}, but this run named environment ` +
        `'${expectedEnvironment}'. Refusing so a staging job cannot write the production prefix ` +
        `(or the reverse).`,
    );
  }

  const envName = expectedEnvironment || envFromPrefix;
  const expected = lookupEnvironment(envName);
  const actualRef = projectRefFromSupabaseUrl(supabaseUrl);
  if (actualRef !== expected.supabaseProjectRef) {
    throw new Error(
      `SUPABASE_URL names project ${actualRef}, not the ${envName} project ` +
        `(${expected.supabaseProjectRef}, ${expected.supabaseProjectName}) that prefix '${prefix}' ` +
        `maps to in .github/environments.json. A mirror taken now would be mislabelled; refusing.`,
    );
  }

  const allowRehearsal =
    allowProductionRehearsal ?? process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_REHEARSAL === "true";
  if (mode === "rehearse" && envName === "production" && !allowRehearsal) {
    throw new Error(
      "Refusing a Storage rehearsal against production. The rehearsal writes and deletes a canary. " +
        "The production nightly job hard-codes rehearsal: false for this reason (no reviewer). " +
        "If you meant to, set STORAGE_BACKUP_ALLOW_PRODUCTION_REHEARSAL=true.",
    );
  }

  const allowRestore =
    allowProductionRestore ?? process.env.STORAGE_BACKUP_ALLOW_PRODUCTION_RESTORE === "true";
  if (mode === "restore" && envName === "production" && !allowRestore) {
    throw new Error(
      "Refusing a Storage restore against production. Restoring overwrites live objects. " +
        "`--prefix storage-production` plus a production SUPABASE_URL is a real incident-response " +
        "action, not a rehearsal. If you meant to, set STORAGE_BACKUP_ALLOW_PRODUCTION_RESTORE=true.",
    );
  }

  return { environment: envName, projectRef: actualRef };
}

/**
 * Flatten one page of Storage's list response.
 *
 * Storage returns folders as rows with a null `id`; only leaves carry metadata.
 * Filtering on `id` rather than on a name heuristic is what keeps a real object
 * named like a folder from being skipped.
 */
export function parseObjectPage(rows, bucket, prefix) {
  const files = [];
  const folders = [];
  for (const row of rows ?? []) {
    const path = prefix ? `${prefix}/${row.name}` : row.name;
    if (row.id === null || row.id === undefined) {
      folders.push(path);
      continue;
    }
    files.push({
      bucket,
      path,
      size: row.metadata?.size ?? null,
      // Storage quotes the etag; strip it so a value read back from our own
      // manifest compares equal to a freshly listed one.
      etag: row.metadata?.eTag ? String(row.metadata.eTag).replace(/^"|"$/g, "") : null,
      mime_type: row.metadata?.mimetype ?? null,
      updated_at: row.updated_at ?? null,
    });
  }
  return { files, folders };
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// -- Storage REST client -----------------------------------------------------

function storageHeaders(serviceKey) {
  // Storage wants both. `apikey` routes the request at the gateway; the bearer
  // is what actually authorizes, and with the service role it bypasses RLS.
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function listBuckets({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  const res = await fetchImpl(`${supabaseUrl}/storage/v1/bucket`, {
    headers: storageHeaders(serviceKey),
  });
  if (!res.ok) {
    throw new Error(`Listing buckets failed: HTTP ${res.status}`);
  }
  return (await res.json()).map((b) => b.name ?? b.id);
}

/**
 * Every object in a bucket, walking folders breadth-first.
 *
 * Storage's list endpoint returns one level at a time and is paginated, with no
 * recursive mode -- so this is the only way to enumerate a bucket, and it must
 * page or it silently truncates at the default limit.
 */
export async function listBucketObjects({ supabaseUrl, serviceKey, bucket, fetchImpl = fetch }) {
  const out = [];
  const queue = [""];

  while (queue.length > 0) {
    const prefix = queue.shift();
    let offset = 0;

    for (;;) {
      const res = await fetchImpl(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { ...storageHeaders(serviceKey), "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix,
          limit: LIST_PAGE_SIZE,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      });
      if (!res.ok) {
        throw new Error(`Listing ${bucket}/${prefix} failed: HTTP ${res.status}`);
      }

      const rows = await res.json();
      const { files, folders } = parseObjectPage(rows, bucket, prefix);
      out.push(...files);
      queue.push(...folders);

      if (rows.length < LIST_PAGE_SIZE) break;
      offset += LIST_PAGE_SIZE;
    }
  }

  return out;
}

export async function downloadObject({ supabaseUrl, serviceKey, bucket, path, fetchImpl = fetch }) {
  const res = await fetchImpl(
    `${supabaseUrl}/storage/v1/object/${bucket}/${encodePath(path)}`,
    { headers: storageHeaders(serviceKey) },
  );
  if (!res.ok) {
    throw new Error(`Downloading ${bucket}/${path} failed: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function uploadObject({
  supabaseUrl,
  serviceKey,
  bucket,
  path,
  body,
  contentType,
  fetchImpl = fetch,
}) {
  // `upsert` so a restore over a surviving object is idempotent rather than a
  // 409 -- a restore that fails halfway must be safe to re-run.
  const res = await fetchImpl(`${supabaseUrl}/storage/v1/object/${bucket}/${encodePath(path)}`, {
    method: "POST",
    headers: {
      ...storageHeaders(serviceKey),
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Uploading ${bucket}/${path} failed: HTTP ${res.status}`);
  }
}
