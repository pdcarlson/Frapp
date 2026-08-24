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
export const MAX_ARCHIVE_UPLOAD_LABEL = "100 MB";

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
 * — verified against the local stack: a signed-URL PUT of a type outside that
 * list answers 415 `invalid_mime_type` from storage-api.
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
  dotted: ReadonlySet<string>;
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
    dotted: new Set([...extensions].map((ext) => `.${ext}`)),
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

/** Extensions with a leading dot — the form most API services historically used. */
export function uploadExtensionsDotted(kind: UploadKind): ReadonlySet<string> {
  return KINDS[kind].dotted;
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
  | { ok: true; contentType: string }
  | { ok: false; reason: "type" | "size" };

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
