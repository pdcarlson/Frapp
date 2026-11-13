#!/usr/bin/env node
//
// Downscales the profile photos and chapter logos already in storage to
// `AVATAR_MAX_EDGE` (512px) on their longest edge (#2912).
//
// Since #2912 every client shrinks a photo or logo before the PUT, so new
// uploads arrive small. This is for the objects stored before that: a phone
// photo uploaded as picked, up to the 25 MB cap, that every 24-84px avatar
// downloads in full. Until it runs, those objects still render: they are only
// larger than they need to be.
//
// Each object is rewritten **in place** (same bucket, same path, same type), so
// `users.avatar_url` and `chapters.logo_path` keep pointing at it and nothing
// in the database changes. An object is left alone when it is already within
// the bound and small, when the re-encode would not be smaller, or when sharp
// can't decode it. An animated GIF keeps its first frame.
//
// Idempotent and re-runnable: a rewritten object is within the bound, so a
// second run skips it.
//
// Env inputs:
//   SUPABASE_URL               required, e.g. https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  required, bypasses RLS -- never log it
//
// Usage:
//   node scripts/backfill-avatar-downscale.mjs           # report only
//   node scripts/backfill-avatar-downscale.mjs --apply   # rewrite

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { pathToFileURL } from "node:url";
import { requireEnv } from "./ci/lib/env.mjs";

/** `AVATAR_MAX_EDGE` in `@repo/validation`; a script can't import its TS source. */
export const AVATAR_MAX_EDGE = 512;

/** Within the bound and under this, an object is left as it is. */
const KEEP_AS_IS_BYTES = 256 * 1024;

/** Above any realistic row count; re-run for the remainder. */
const MAX_ROWS = 20_000;

/**
 * The downscaled bytes for `input`, or `null` when it should be left alone.
 * The output keeps the input's format, so the stored path's extension and the
 * object's content type stay true.
 */
export async function shrinkImage(input) {
  let image;
  let meta;
  try {
    // `pages: 1` reads only the first frame of an animated GIF or WebP.
    image = sharp(input, { pages: 1 }).rotate();
    meta = await sharp(input).metadata();
  } catch {
    return null;
  }
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const height = meta.autoOrient?.height ?? meta.height ?? 0;
  const animated = (meta.pages ?? 1) > 1;
  if (!width || !height) return null;
  if (
    Math.max(width, height) <= AVATAR_MAX_EDGE &&
    !animated &&
    input.length <= KEEP_AS_IS_BYTES
  ) {
    return null;
  }

  image = image.resize({
    width: AVATAR_MAX_EDGE,
    height: AVATAR_MAX_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });
  switch (meta.format) {
    case "jpeg":
      image = image.jpeg({ quality: 85, mozjpeg: true });
      break;
    case "png":
      image = image.png({ compressionLevel: 9, palette: false });
      break;
    case "webp":
      image = image.webp({ quality: 85 });
      break;
    case "gif":
      image = image.gif();
      break;
    default:
      return null;
  }
  let output;
  try {
    output = await image.toBuffer();
  } catch {
    return null;
  }
  return output.length < input.length ? output : null;
}

const CONTENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Every stored profile photo and chapter logo, as `{ bucket, path }`. */
async function listTargets(supabase) {
  const [users, chapters] = await Promise.all([
    supabase
      .from("users")
      .select("avatar_url")
      .not("avatar_url", "is", null)
      .limit(MAX_ROWS),
    supabase
      .from("chapters")
      .select("logo_path")
      .not("logo_path", "is", null)
      .limit(MAX_ROWS),
  ]);
  if (users.error) throw users.error;
  if (chapters.error) throw chapters.error;
  return [
    // A URL is not a stored object (`ProfilePhotoUrlService` serves it as null).
    ...users.data
      .map((row) => row.avatar_url)
      .filter((path) => typeof path === "string" && !/^[a-z]+:/i.test(path))
      .map((path) => ({ bucket: "profiles", path })),
    ...chapters.data.map((row) => ({
      bucket: "branding",
      path: row.logo_path,
    })),
  ];
}

async function backfill(supabase, { apply }) {
  const targets = await listTargets(supabase);
  let shrunk = 0;
  let kept = 0;
  let failed = 0;
  let before = 0;
  let after = 0;

  for (const { bucket, path } of targets) {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) {
      kept++;
      continue;
    }
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) {
      console.warn(`skip ${bucket}/${path}: download failed`);
      failed++;
      continue;
    }
    const input = Buffer.from(await data.arrayBuffer());
    const output = await shrinkImage(input);
    if (!output) {
      kept++;
      continue;
    }
    before += input.length;
    after += output.length;
    if (!apply) {
      console.log(
        `[report] ${bucket}/${path}: ${input.length} -> ${output.length} bytes`,
      );
      shrunk++;
      continue;
    }
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, output, { contentType, upsert: true });
    if (uploadError) {
      console.warn(
        `skip ${bucket}/${path}: upload failed — ${uploadError.message}`,
      );
      failed++;
      continue;
    }
    shrunk++;
  }

  return { total: targets.length, shrunk, kept, failed, before, after };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );
  const { total, shrunk, kept, failed, before, after } = await backfill(
    supabase,
    { apply },
  );
  console.log(
    `${apply ? "" : "[report] "}${total} object(s): ${apply ? "shrank" : "would shrink"} ${shrunk} (${before} -> ${after} bytes), kept ${kept}, failed ${failed}.`,
  );
  if (!apply && shrunk > 0) console.log("Re-run with --apply to rewrite them.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
