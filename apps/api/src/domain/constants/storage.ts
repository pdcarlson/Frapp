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
 * assumed the API would fetch each object from Discord's CDN itself and place it
 * once the Signet ids existed. It does not: the admin's browser uploads the
 * files directly, before any Signet channel or message id has been assigned, so
 * a message-derived key is unknowable at upload time. Keying on the import
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
export function archiveMediaPrefix(
  chapterId: string,
  importId: string,
): string {
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
