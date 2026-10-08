/**
 * Size ceilings for a Discord archive import, which only the API enforces
 * (#3268). The `archive` upload kind's MIME table stays shared in
 * `@repo/validation` (`upload-allowlists.ts`), next to the reason the kind
 * exists and is held off the 25 MB member-upload cap.
 */

/**
 * One object in the private `chat-archive` bucket: the bucket's own 100 MB
 * limit (`supabase/migrations/20260823124000_chat_archive_bucket.sql`), four
 * times `MAX_UPLOAD_BYTES`, because a Discord archive carries video and audio
 * that the live-chat cap would drop.
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
 * Binary, like every other upload ceiling — 20 GiB is ~21.5 GB decimal.
 * Admin-facing messages render it through `formatBytes`, which labels binary
 * units the way a file browser does, so the copy reads "20 GB" and the constant
 * stays exact. Do not "correct" one to match the other.
 *
 * **This is not a capacity plan for the hosted project.** It is an abuse
 * ceiling. What the hosted projects can actually hold (the org's Pro storage
 * quota and each project's 100 MB per-object limit) is recorded in
 * `docs/ops/deployment/supabase.md` § Plan and quotas. Lowering this to track a real
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
 * Size check for the `archive` kind. Separate from
 * `isWithinUploadSizeLimit` (`@repo/validation`) so the member-upload ceiling stays where it is.
 */
export function isWithinArchiveUploadSizeLimit(byteLength: number): boolean {
  return (
    Number.isFinite(byteLength) &&
    byteLength >= 0 &&
    byteLength <= MAX_ARCHIVE_UPLOAD_BYTES
  );
}
