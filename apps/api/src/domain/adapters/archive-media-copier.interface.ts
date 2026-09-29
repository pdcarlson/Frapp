export const ARCHIVE_MEDIA_COPIER = 'ARCHIVE_MEDIA_COPIER';

/**
 * One Discord attachment to copy from its CDN URL into the archive bucket.
 *
 * The caller has already decided the copy is allowed: the manifest row exists,
 * the archive quota admitted it, and its declared size and type passed the
 * archive's checks. The copier moves bytes and nothing else.
 */
export interface ArchiveMediaCopyItem {
  /** The CDN URL from Discord's API response. Signed and expiring. */
  url: string;
  bucket: string;
  /** The object key, `archiveMediaObjectPath`'s output. */
  path: string;
  /** The allowlist-checked type, or null to take the CDN's own header. */
  contentType: string | null;
  /** Discord's `attachment.size`, when it declared one. */
  declaredSize: number | null;
}

/**
 * - `stored`: the object now exists at `path`.
 * - `gone`: Discord's CDN no longer serves the attachment.
 * - `rejected`: refused before any transfer (host, bucket, path or size).
 * - `failed`: attempted and did not land.
 * - `deferred`: not attempted in this call. Send it again.
 */
export type ArchiveMediaCopyStatus =
  'stored' | 'gone' | 'rejected' | 'failed' | 'deferred';

export interface ArchiveMediaCopyResult {
  path: string;
  status: ArchiveMediaCopyStatus;
  /** The object's size from the CDN's `Content-Length`, when it sent one. */
  bytes?: number;
  reason?: string;
}

/**
 * The copy service itself failed, as opposed to one attachment in it.
 *
 * Unreachable after retries, refusing the API's credential, missing, or
 * answering in a shape the API cannot read. The worker lets it fail the
 * import: every attachment in the batch is in an unknown state, and treating
 * each as a skipped file would let an import finish with no media while
 * reporting success.
 */
export class ArchiveMediaCopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveMediaCopyError';
  }
}

/**
 * Copies Discord attachments into Storage without the bytes passing through
 * this process (#2848).
 *
 * The implementation calls the `discord-attachment-copy` Edge Function, so the
 * API sends a few hundred bytes per attachment instead of the file, which
 * Render would bill as outbound bandwidth. See ADR-26.
 */
export interface IArchiveMediaCopier {
  /**
   * Copy a batch. Returns one result per item, in the items' order.
   *
   * A call answers within its own time budget, so `deferred` results are
   * normal on a large batch; every call resolves at least one item.
   *
   * @throws ArchiveMediaCopyError when the copy service itself failed.
   */
  copy(items: ArchiveMediaCopyItem[]): Promise<ArchiveMediaCopyResult[]>;
}
