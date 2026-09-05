/**
 * Shared upload MIME / extension allowlists and the 25 MB size cap.
 *
 * One table per kind; MIME types, extensions, the HTML `accept` attribute, and
 * the size bound all derive from it. Application services, web upload pages,
 * and the chat composer import these helpers — they do not keep a second copy.
 *
 * Kinds:
 * - `image` — avatars and chapter logos (jpeg / png / gif / webp)
 * - `proof` — service-hour receipts (images + PDF)
 * - `document` — chapter files, backwork, and chat attachments (images + PDF +
 *   Office + text/csv)
 *
 * Documents, backwork, and chat share `document` on purpose. The live GIF bug
 * (Documents accepted `image/gif`; the structurally identical Backwork page
 * refused it client-side before the API was called) happened because those two
 * pages kept separate copies of the same list. `DOCUMENT_UPLOAD_SURFACES`
 * names the three callers that must stay on this kind; a regression test
 * pins `image/gif` on it.
 *
 * Legacy Office MIME types (`application/msword`, `application/vnd.ms-excel`,
 * `application/vnd.ms-powerpoint` — `.doc` / `.xls` / `.ppt`) stay on the
 * allowlist. The API and every matching storage bucket already accept them;
 * every web client's map/`accept` had omitted them. Completing the client is
 * the decision — dropping them server-side would reject files the buckets
 * still store and that API callers can already upload.
 *
 * SVG (`image/svg+xml`, `.svg`) is never on these lists. SVGs can embed
 * script; see `docs/internal/security/content-validation.md`.
 *
 * Bucket policies in `supabase/migrations/*.sql` must keep mirroring these
 * MIME lists (comment cross-references only on shipped migrations). Size is
 * `MAX_UPLOAD_BYTES` (26214400), matching `supabase/config.toml`.
 *
 * ## What the bucket allowlist actually enforces
 *
 * Canonical statement. Other sites summarise in a sentence and link here
 * rather than repeating the detail — one canonical place per fact, per
 * `docs/internal/DOCUMENTATION_CONVENTIONS.md` § Where a fact lives. Restating
 * it is how a wrong status code reached nine sites in the first place.
 *
 * Measured against the **local** stack (storage-api 1.66.4) on a throwaway
 * bucket with `allowed_mime_types: ["image/png"]`:
 *
 * - A signed-URL PUT declaring a type outside the list is rejected with
 *   **HTTP 400**, carrying the body
 *   `{"statusCode":"415","error":"invalid_mime_type","message":"mime type
 *   text/html is not supported"}`. The `415` is a field *inside that body*,
 *   not the response status — reading it as the status is what put
 *   "answers 415" in nine comments across this repo. Eight are corrected; the
 *   ninth is a shipped migration comment, tracked in #1409.
 * - The list gates the **client-declared `Content-Type` header, never the
 *   bytes**. HTML uploaded while declaring `image/png` is accepted (200) and
 *   stored, and a signed download returns it as `image/png` with the markup
 *   intact.
 *
 * So the allowlist does not keep hostile bytes out of a bucket — it constrains
 * the type they are served as. What stops a browser rendering them is decided
 * per call on the *download* side: `getSignedDownloadUrl`'s `downloadAs` sets
 * `Content-Disposition: attachment`, and the chat attachment path does pass it
 * (`ChatService.getMessageAttachments`). A URL minted **without** `downloadAs`
 * carried neither that header nor `X-Content-Type-Options: nosniff` in the
 * capture above, so for those the served type is all that is left.
 *
 * Deliberately **not** measured, and so not claimed anywhere: any hosted
 * Supabase environment (this capture is local only, and an edge layer is
 * exactly the sort of thing that adds response headers), and how any given
 * browser actually treats such a response.
 *
 * The application-layer check in each service therefore gates URL *issuance*
 * only. It is a real half of the pair — it turns a rejection into a readable
 * error rather than a failed PUT — but it is not a second enforcement point.
 * See `docs/internal/security/content-validation.md` and #1230.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "25 MB";

export type UploadKind = "image" | "proof" | "document" | "archive";

/**
 * The `archive` kind is NOT a member-upload surface.
 *
 * It exists for one flow: a chapter admin uploading a DiscordChatExporter
 * export into the private `chat-archive` bucket, whose own limits
 * (`supabase/migrations/20260823124000_chat_archive_bucket.sql`) are wider than
 * every other bucket here — 100 MB and 33 types including video and audio,
 * because a Discord archive carries both and the live-chat 25 MB cap would drop
 * the most valuable attachments on the floor.
 *
 * It is kept OFF `MAX_UPLOAD_BYTES` and off the `document` list on purpose:
 * widening those to cover a one-off import would raise the ceiling on every
 * member upload in the product, which is exactly the trade that migration
 * rejected. SVG stays absent here too — an archive is not a reason to make an
 * exception for script-bearing markup.
 */
export const MAX_ARCHIVE_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Ceiling on one uploaded DiscordChatExporter JSON partition.
 *
 * Far below the bucket cap, and deliberately: the importer parses a whole
 * partition into memory with `JSON.parse`, on an API instance sized in hundreds
 * of megabytes that is also serving live chat. 8 MiB of JSON is roughly 25 MB of
 * heap and a sub-100ms synchronous parse; a 100 MB partition is neither.
 *
 * DiscordChatExporter's own `--partition` flag is what keeps exports under this,
 * so the admin-facing error names that flag rather than a byte count.
 */
export const MAX_ARCHIVE_EXPORT_PART_BYTES = 8 * 1024 * 1024;

/**
 * Ceiling on the total bytes one Discord import may register.
 *
 * The two constants above bound a single OBJECT. Neither bounds an import, and
 * nothing else did either (#1243): a `channels:manage` holder could loop
 * create-import → mint 100 upload URLs → repeat, and `CustomThrottlerGuard`
 * bounds request rate, not bytes.
 *
 * The number comes from what a legitimate import actually weighs. A
 * DiscordChatExporter run over an active chapter's server with `--media` is
 * plausibly single-digit GB, so 20 GiB clears any real export by a wide margin
 * and only ever catches a runaway or a deliberate loop.
 *
 * Binary, like every other ceiling in this file — 20 GiB is ~21.5 GB decimal.
 * Admin-facing messages render it through `formatBytes`, which labels binary
 * units the way a file browser does, so the copy reads "20 GB" and the constant
 * stays exact. Do not "correct" one to match the other.
 *
 * **This is not a capacity plan for the hosted project.** It is an abuse
 * ceiling. What the shared Supabase project can actually hold is a separate,
 * still-open question — see #1235 (the hosted per-object limit) and #1403 (the
 * org tier, which is what gates total storage). Lowering this to track a real
 * capacity budget is a one-line edit here, exactly as it is for the two
 * ceilings above.
 */
export const MAX_ARCHIVE_IMPORT_BYTES = 20 * 1024 * 1024 * 1024;

/**
 * Ceiling on the total bytes one chapter may hold across all of its imports.
 *
 * Deliberately above {@link MAX_ARCHIVE_IMPORT_BYTES} rather than equal to it:
 * re-importing after a bad run is the normal recovery path, and a chapter that
 * has not purged the first attempt would otherwise be locked out of the second.
 * Two full-size imports plus headroom.
 *
 * Bytes are released by the per-import purge (`DELETE /v1/discord-imports/{id}`)
 * and by nothing else — there is no retention sweep over this bucket yet
 * (#1246). A chapter that hits this ceiling deletes an old import to continue,
 * which is what the refusal message tells it to do.
 */
export const MAX_ARCHIVE_CHAPTER_BYTES = 50 * 1024 * 1024 * 1024;

/**
 * Surfaces that must share the `document` kind. Adding a fourth member-upload
 * surface that is "the same as documents" means adding it here and using
 * `document` — not copying the list.
 */
export const DOCUMENT_UPLOAD_SURFACES = [
  "documents",
  "backwork",
  "chat",
] as const;

type MimeBinding = {
  mime: string;
  extensions: readonly string[];
};

const IMAGE_BINDINGS: readonly MimeBinding[] = [
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { mime: "image/png", extensions: ["png"] },
  { mime: "image/gif", extensions: ["gif"] },
  { mime: "image/webp", extensions: ["webp"] },
];

const PDF_BINDING: MimeBinding = {
  mime: "application/pdf",
  extensions: ["pdf"],
};

/**
 * Media Discord carries that live chat does not accept. Mirrors the
 * `chat-archive` bucket's `allowed_mime_types`, which is the enforcement point
 * on that bucket — a signed-URL PUT of a type outside the list is rejected by
 * storage-api. See the module header for exactly what that rejection looks
 * like and what the list does and does not gate.
 */
const ARCHIVE_MEDIA_BINDINGS: readonly MimeBinding[] = [
  { mime: "image/bmp", extensions: ["bmp"] },
  { mime: "image/tiff", extensions: ["tif", "tiff"] },
  { mime: "image/avif", extensions: ["avif"] },
  { mime: "image/heic", extensions: ["heic"] },
  { mime: "video/mp4", extensions: ["mp4"] },
  { mime: "video/webm", extensions: ["webm"] },
  { mime: "video/quicktime", extensions: ["mov"] },
  { mime: "video/x-msvideo", extensions: ["avi"] },
  { mime: "video/x-matroska", extensions: ["mkv"] },
  { mime: "audio/mpeg", extensions: ["mp3"] },
  { mime: "audio/ogg", extensions: ["ogg", "oga"] },
  { mime: "audio/wav", extensions: ["wav"] },
  { mime: "audio/webm", extensions: ["weba"] },
  { mime: "audio/mp4", extensions: ["m4a"] },
  { mime: "audio/flac", extensions: ["flac"] },
  { mime: "text/markdown", extensions: ["md"] },
  { mime: "application/json", extensions: ["json"] },
  { mime: "application/zip", extensions: ["zip"] },
  { mime: "application/gzip", extensions: ["gz"] },
  { mime: "application/x-7z-compressed", extensions: ["7z"] },
];

const OFFICE_AND_TEXT_BINDINGS: readonly MimeBinding[] = [
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"],
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extensions: ["pptx"],
  },
  { mime: "application/msword", extensions: ["doc"] },
  { mime: "application/vnd.ms-excel", extensions: ["xls"] },
  { mime: "application/vnd.ms-powerpoint", extensions: ["ppt"] },
  { mime: "text/plain", extensions: ["txt"] },
  { mime: "text/csv", extensions: ["csv"] },
];

interface KindTable {
  mimes: ReadonlySet<string>;
  extensions: ReadonlySet<string>;
  byExtension: Record<string, string>;
  accept: string;
  mimeList: readonly string[];
}

function freezeKind(bindings: readonly MimeBinding[]): KindTable {
  const mimes = new Set<string>();
  const extensions = new Set<string>();
  const byExtension: Record<string, string> = {};
  const mimeList: string[] = [];

  for (const binding of bindings) {
    mimes.add(binding.mime);
    mimeList.push(binding.mime);
    for (const ext of binding.extensions) {
      extensions.add(ext);
      byExtension[ext] = binding.mime;
    }
  }

  return {
    mimes,
    extensions,
    byExtension,
    accept: [...extensions].map((ext) => `.${ext}`).join(","),
    mimeList,
  };
}

const KINDS: Record<UploadKind, KindTable> = {
  image: freezeKind(IMAGE_BINDINGS),
  proof: freezeKind([...IMAGE_BINDINGS, PDF_BINDING]),
  document: freezeKind([
    ...IMAGE_BINDINGS,
    PDF_BINDING,
    ...OFFICE_AND_TEXT_BINDINGS,
  ]),
  archive: freezeKind([
    ...IMAGE_BINDINGS,
    PDF_BINDING,
    ...OFFICE_AND_TEXT_BINDINGS,
    ...ARCHIVE_MEDIA_BINDINGS,
  ]),
};

/**
 * Size check for the `archive` kind. Separate from
 * `isWithinUploadSizeLimit` so the member-upload ceiling stays where it is.
 */
export function isWithinArchiveUploadSizeLimit(byteLength: number): boolean {
  return (
    Number.isFinite(byteLength) &&
    byteLength >= 0 &&
    byteLength <= MAX_ARCHIVE_UPLOAD_BYTES
  );
}

export function uploadMimeTypes(kind: UploadKind): ReadonlySet<string> {
  return KINDS[kind].mimes;
}

export function uploadMimeList(kind: UploadKind): readonly string[] {
  return KINDS[kind].mimeList;
}

/** Extensions without a leading dot, lowercase. */
export function uploadExtensions(kind: UploadKind): ReadonlySet<string> {
  return KINDS[kind].extensions;
}

export function contentTypeByExtension(
  kind: UploadKind,
): Readonly<Record<string, string>> {
  return KINDS[kind].byExtension;
}

/** Value for an `<input type="file" accept>` attribute. */
export function acceptAttribute(kind: UploadKind): string {
  return KINDS[kind].accept;
}

/**
 * Lowercase extension without a leading dot. Empty when `filename` has no
 * usable extension (no dot, or a trailing dot).
 */
export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Accepts a filename (`notes.gif`), a dotted extension (`.gif`), or a bare
 * extension (`gif`). Empty string if there is nothing to match.
 */
export function normalizeExtension(filenameOrExt: string): string {
  const trimmed = filenameOrExt.trim();
  if (trimmed.length === 0) return "";
  if (!trimmed.includes(".")) return trimmed.toLowerCase();
  return fileExtension(trimmed);
}

export function isAllowedUploadExtension(
  kind: UploadKind,
  filenameOrExt: string,
): boolean {
  const ext = normalizeExtension(filenameOrExt);
  if (!ext) return false;
  return KINDS[kind].extensions.has(ext);
}

export function isAllowedUploadMime(
  kind: UploadKind,
  contentType: string,
): boolean {
  return KINDS[kind].mimes.has(contentType);
}

export function isWithinUploadSizeLimit(byteLength: number): boolean {
  return (
    Number.isFinite(byteLength) &&
    byteLength >= 0 &&
    byteLength <= MAX_UPLOAD_BYTES
  );
}

/**
 * MIME to send with a signed-URL request. Prefers the extension map so a
 * browser that leaves `file.type` empty (common for legacy Office) still
 * produces the type the API and bucket expect.
 */
export function mimeForUploadFile(
  kind: UploadKind,
  file: { name: string; type: string },
): string | undefined {
  const ext = fileExtension(file.name);
  if (ext) {
    const fromExt = KINDS[kind].byExtension[ext];
    if (fromExt) return fromExt;
  }
  if (file.type && isAllowedUploadMime(kind, file.type)) return file.type;
  return undefined;
}

export type InspectedUpload =
  { ok: true; contentType: string } | { ok: false; reason: "type" | "size" };

/**
 * Client-side gate used by the web upload pages and the chat composer.
 * Type is checked first so a huge `.exe` is rejected as a disallowed type,
 * not as an oversized file.
 */
export function inspectUploadFile(
  kind: UploadKind,
  file: { name: string; type: string; size: number },
): InspectedUpload {
  const contentType = mimeForUploadFile(kind, file);
  if (!contentType || !isAllowedUploadExtension(kind, file.name)) {
    return { ok: false, reason: "type" };
  }
  if (!isWithinUploadSizeLimit(file.size)) {
    return { ok: false, reason: "size" };
  }
  return { ok: true, contentType };
}
