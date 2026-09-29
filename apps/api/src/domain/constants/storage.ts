import { posix } from 'node:path';
import { isUnsafeStoragePath } from '../utils/storage-path';

/**
 * Profile-photo storage layout, shared by the upload path
 * (UserService.requestAvatarUploadUrl) and the account-deletion purge
 * (AccountDeletionService). Keeping bucket + folder shape in one place is
 * load-bearing: the purge treats an empty folder as success, so a layout
 * change made in only one of the two services would silently orphan PII.
 */
export const PROFILES_BUCKET = 'profiles';

/** Folder holding a user's profile photos within one chapter (no trailing slash). */
export function profileFolderPrefix(chapterId: string, userId: string): string {
  return `chapters/${chapterId}/profiles/${userId}`;
}

/** Exactly `chapters/<chapter>/profiles/<user>/<file>`, one segment each. */
const PROFILE_PHOTO_PATH =
  /^chapters\/([^/\\]+)\/profiles\/([^/\\]+)\/([^/\\]+)$/;

/**
 * The owner of a bare profile-photo storage path, or null when `value` is not
 * one: a URL, a nested path, or a path with a dot segment.
 *
 * This is the shape `users.avatar_url` holds once a member confirms an upload
 * (`UserService.confirmAvatarUpload`), and the only shape the read path signs.
 * The two purges (`AccountDeletionService.avatarUrlFolder`,
 * `MemberService.remove`) parse more loosely on purpose, because they must also
 * find the folder inside a legacy URL; signing must not.
 */
export function parseProfilePhotoPath(
  value: string,
): { chapterId: string; userId: string; folder: string } | null {
  const match = PROFILE_PHOTO_PATH.exec(value);
  if (!match || isUnsafeStoragePath(value)) return null;
  const [, chapterId, userId] = match;
  return {
    chapterId,
    userId,
    folder: profileFolderPrefix(chapterId, userId),
  };
}

/**
 * `value` when it is a profile-photo path in `userId`'s own folder, else null.
 *
 * The one ownership rule for a stored `users.avatar_url`: what the read path
 * signs (`ProfilePhotoUrlService`) and what a photo change may delete
 * (`UserService`). Any other value, a URL included, could only have been
 * written through the free-text `PATCH /v1/users/me` that #2519 closed.
 */
export function ownProfilePhotoPath(
  value: string | null | undefined,
  userId: string,
): string | null {
  if (!value) return null;
  return parseProfilePhotoPath(value)?.userId === userId ? value : null;
}

/**
 * Generated-report storage layout, shared by the export path
 * (ReportExportService) and the two purges that reap it — the scheduled
 * retention sweep and the account-deletion sweep (ReportRetentionService).
 *
 * Here for the same reason as the profiles pair above, and the stakes are
 * higher: roster exports embed member names, emails, roles, and join dates
 * (`report-columns.ts` ROSTER_COLUMNS), and both purges treat an empty folder
 * as success. A layout change made in the writer alone would leave the purges
 * sweeping a prefix nothing writes to, reporting success over surviving PII.
 */
export const REPORTS_BUCKET = 'reports';

/**
 * Folder whose sub-folders are the chapters that hold generated reports.
 *
 * The retention sweep enumerates its children rather than reading chapter ids
 * from the database. Storage folders are virtual — one exists exactly while an
 * object lives beneath it — so this yields the chapters that actually have
 * exports, and drops each back out once its prefix is swept empty. Two things
 * fall out of that: the sweep costs one listing per *exporting* chapter rather
 * than per chapter in the product, and a prefix whose `chapters` row was
 * deleted still gets reaped instead of being stranded with nothing left to
 * name it.
 */
export const REPORTS_ROOT_PREFIX = 'chapters';

/** Folder holding one chapter's generated reports (no trailing slash). */
export function reportsFolderPrefix(chapterId: string): string {
  return `${REPORTS_ROOT_PREFIX}/${chapterId}/reports`;
}

/**
 * Discord-archive storage layout.
 *
 * The `chat-archive` bucket (migration `20260823124000`) holds media pulled out
 * of a Discord export: 100 MB per object, 33 MIME types, no SVG, private with
 * no storage RLS policies like every other bucket here.
 *
 * **This layout supersedes the one that migration's header declared.** It wrote
 * `chapters/{chapter}/chat-archive/{channel_id}/{message_id}/{basename}`, which
 * assumed every object would be placed once the Frapp ids existed. On the
 * upload path they are not: the admin's browser uploads the files directly,
 * before any Frapp channel or message id has been assigned, so a
 * message-derived key is unknowable at upload time. (The bot path does fetch
 * from Discord's CDN server-side, and shares this key via
 * `archiveMediaObjectPath` below.) Keying on the import
 * instead also gives the purge a single prefix to sweep — which matters more
 * than it sounds, because there is no chapter-deletion path in the product and
 * nothing else reaps this bucket, so the import is the only lifecycle it has.
 */
export const CHAT_ARCHIVE_BUCKET = 'chat-archive';

/** Everything one import owns (no trailing slash). The purge sweeps this. */
export function archiveImportPrefix(
  chapterId: string,
  importId: string,
): string {
  return `chapters/${chapterId}/chat-archive/imports/${importId}`;
}

/** The uploaded DiscordChatExporter JSON partitions for one import. */
export function archiveExportPrefix(
  chapterId: string,
  importId: string,
): string {
  return `${archiveImportPrefix(chapterId, importId)}/export`;
}

/** The uploaded media (attachments, avatars) for one import. */
function archiveMediaPrefix(chapterId: string, importId: string): string {
  return `${archiveImportPrefix(chapterId, importId)}/media`;
}

/**
 * Collapse an export-relative path into one safe storage segment.
 *
 * The media prefix is deliberately kept exactly one level deep, for two
 * independent reasons. `IStorageProvider.listFiles` does not recurse, so the
 * purge would otherwise need a directory walk to find what to delete; and a
 * client-supplied path fragment never reaches `assertSafeObjectPath` in a shape
 * it has to reason about, because every separator is gone before the key is
 * built.
 *
 * Not reversible, and it does not need to be: `discord_import_files` stores the
 * original `relative_path` alongside the derived `storage_path`, and the
 * importer joins on the stored string rather than re-deriving it.
 *
 * Two different source paths can flatten to the same segment (`a/b.png` and
 * `a_b.png`). The caller disambiguates by prefixing a short digest of the
 * ORIGINAL path (`hashSegment` in `discord-import.service.ts`), so this stays a
 * pure, testable string function with no collision policy baked in.
 */
export function flattenArchiveRelativePath(relativePath: string): string {
  return relativePath.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 180);
}

/**
 * Matches each character a storage key segment may not keep. What it may keep
 * is storage-api's own `VALID_OBJECT_KEY` set,
 * `[A-Za-z0-9_/!.*'() &$=@;:+,?-]` (`supabase/storage`
 * `src/storage/limits.ts`), minus `/`, which would add a folder, and `?`,
 * which `@supabase/storage-js` puts into the request URL unencoded, so the key
 * would be cut at it.
 */
const UNSAFE_OBJECT_KEY_CHAR = /[^A-Za-z0-9_!.*'() &$=@;:+,-]/g;

/**
 * The last segment of a storage key built from a client-supplied filename.
 *
 * Every upload-URL route that puts the member's filename into the key
 * (documents, backwork, chat attachments, service proof) goes through
 * this, because a raw name breaks the upload in ways the traversal guard does
 * not catch. storage-js interpolates the key into the request URL unencoded,
 * and against storage-api:
 *
 * - `Résumé.pdf` (anything non-ASCII) mints, then the browser's PUT is refused
 *   with `Invalid key`.
 * - `Q1 50% growth.pdf` fails at the mint (a raw `%` is malformed
 *   percent-encoding), which `SupabaseStorageService.getSignedUploadUrl` turns
 *   into a 500.
 * - `Rush #3.pdf` and `q?.pdf` succeed, but the object lands under a key cut
 *   at the `#` or `?` (`Rush `, `q`) while the API confirms the uncut path, so
 *   the row points at nothing.
 *
 * `posix.basename` drops any `/`-separated directory part; then each character
 * `UNSAFE_OBJECT_KEY_CHAR` matches becomes `_`, one for one (a backslash
 * included).
 *
 * **The squash is deliberately no wider than that.** A name storage-api
 * already accepted (`Meeting notes (final).pdf`, `Bob's, A&B.pdf`) comes out
 * unchanged, because the key's last segment is also the name a member's
 * download is saved under: chat signs with `download: true`, which sends
 * `Content-Disposition: attachment` with no filename, so the browser takes the
 * URL's last segment, and documents and backwork sign with no `downloadAs`.
 * Squashing spaces or parentheses would rename every such file on disk. The
 * stored display name (a document's `title`, a chat attachment's `filename`)
 * is untouched either way. (Profile photos no longer use this: their key is a
 * server-minted uuid, `UserService.requestAvatarUploadUrl`.)
 *
 * A `.` or `..` result is left for `assertSafeObjectPath` to refuse, and every
 * caller's extension allowlist rejects those first anyway. Only new keys are
 * built this way: an existing row keeps the key it was confirmed with.
 */
export function safeObjectFilename(filename: string): string {
  return posix.basename(filename).replace(UNSAFE_OBJECT_KEY_CHAR, '_');
}

/**
 * Short, stable, filename-safe digest of an original relative path.
 *
 * Disambiguates two source paths that flatten to the same segment
 * (`a/b.png` and `a_b.png`). Not a security control — the path is already
 * server-owned by the time it is used — so a cheap non-cryptographic hash is
 * the right tool.
 */
function hashSegment(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

/**
 * The storage key one piece of imported media lives at.
 *
 * Shared by both import paths on purpose, and it is worth saying why rather
 * than treating it as tidiness: the purge sweeps `archiveImportPrefix` and
 * treats an empty prefix as success. If the DiscordChatExporter upload path and
 * the bot path derived keys differently, one of them would be writing media the
 * purge does not look for, and the purge would report success over surviving
 * chapter content. One function means that cannot drift.
 *
 * `relativePath` is whatever the source calls the file — an export-relative
 * path on the upload path, `{attachment_id}/{filename}` on the bot path. Either
 * way it is the manifest's join key, stored verbatim in
 * `discord_import_files.relative_path`, and this derivation is never reversed:
 * resolution is always a lookup on the stored string.
 */
export function archiveMediaObjectPath(
  chapterId: string,
  importId: string,
  relativePath: string,
): string {
  // The manifest's own uniqueness is (import_id, relative_path), and two
  // distinct relative paths can flatten to the same segment — so the flattened
  // name alone is not a key. The digest of the ORIGINAL path is what keeps
  // distinct sources distinct.
  return `${archiveMediaPrefix(chapterId, importId)}/${hashSegment(
    relativePath,
  )}-${flattenArchiveRelativePath(relativePath)}`;
}
