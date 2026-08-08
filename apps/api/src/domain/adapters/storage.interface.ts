export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

/** One stored object, with the metadata age-based retention needs. */
export interface StorageObject {
  /** Bucket-relative path, prefix included — the same shape `listFiles` returns. */
  path: string;
  /**
   * When the object was stored, or null when the backend did not report it.
   * A null is deliberately NOT treated as "infinitely old" by callers: an
   * age-based purge that guesses would delete a live export on a metadata
   * gap, and reports are re-reaped on the next tick anyway.
   */
  createdAt: Date | null;
}

export interface IStorageProvider {
  getSignedUploadUrl(
    bucket: string,
    path: string,
    contentType: string,
  ): Promise<string>;
  getSignedDownloadUrl(
    bucket: string,
    path: string,
    expiresIn?: number,
    /**
     * When set, the URL forces a download with this filename instead of
     * rendering inline — storage keys are opaque, so without it a saved report
     * lands on disk as a UUID.
     */
    downloadAs?: string,
  ): Promise<string>;
  /**
   * Upload bytes the API produced itself (as opposed to handing a client a
   * signed upload URL) — used by server-side report rendering.
   */
  uploadFile(
    bucket: string,
    path: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void>;
  /**
   * Read an object back into memory. Returns null when the object is missing,
   * so optional assets (a chapter logo) do not need a separate existence check.
   */
  downloadFile(bucket: string, path: string): Promise<Uint8Array | null>;
  deleteFile(bucket: string, path: string): Promise<void>;
  /** Delete many objects in as few provider calls as the backend allows. */
  deleteFiles(bucket: string, paths: string[]): Promise<void>;
  /**
   * List ALL object paths (bucket-relative, prefix included) directly under a
   * folder prefix, paginating internally until exhausted. Returns [] for an
   * empty or non-existent prefix.
   */
  listFiles(bucket: string, prefix: string): Promise<string[]>;
  /**
   * `listFiles` plus each object's stored-at timestamp, for callers that
   * retain by age. Same prefix semantics, same empty-for-missing-bucket
   * behavior; kept separate so the path-only callers stay untouched.
   */
  listObjects(bucket: string, prefix: string): Promise<StorageObject[]>;
  /**
   * Names of the sub-folders directly under a prefix (no trailing slash, name
   * only — not prefix-joined).
   *
   * The counterpart to `listFiles`, which drops folder rows. Storage folders
   * are virtual: one exists exactly while some object lives beneath it, so
   * this enumerates the *occupied* prefixes and a swept-empty folder simply
   * stops being returned. That is what lets a prefix-walking sweep find its
   * own work without a database to name the prefixes for it.
   */
  listFolders(bucket: string, prefix: string): Promise<string[]>;
}
