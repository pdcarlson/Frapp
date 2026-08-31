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

/** Options for {@link IStorageProvider.getSignedUploadUrl}. */
export interface SignedUploadOptions {
  /**
   * Allow the signed URL to overwrite an object that already exists.
   *
   * Off by default, which is the right default for a member upload: a
   * server-minted key is unique per upload, so a collision means something is
   * wrong. On for the Discord archive importer, where a re-signed key is a
   * resumed upload — verified against the local stack, re-signing an existing
   * key without this answers 409 Duplicate, which would strand an admin whose
   * upload dropped halfway through a several-thousand-file archive.
   */
  upsert?: boolean;
}

/** Options for a streaming {@link IStorageProvider.uploadFile}. */
export interface StreamUploadOptions {
  /**
   * Byte length of the body, when the source declared one.
   *
   * Without it a stream body is sent with chunked transfer encoding, which
   * works but denies the storage backend the chance to reject an oversized
   * object before it has read the whole thing.
   */
  contentLength?: number | null;
}

export interface IStorageProvider {
  getSignedUploadUrl(
    bucket: string,
    path: string,
    /**
     * The type the caller expects to be uploaded — **declared intent, not an
     * enforced constraint.**
     *
     * A signed upload URL cannot pin a content type: the client sets its own
     * `Content-Type` on the PUT and the API never sees the bytes. So passing a
     * value here does not make the upload that type, and an implementation
     * cannot forward it to the storage backend to make it one.
     *
     * A caller must therefore still validate it itself — `isAllowedUploadMime`
     * from `@repo/validation` — before asking for a URL, and must not treat
     * this parameter as a server-side gate. The gate is the bucket's
     * `allowed_mime_types`, and it constrains only the declared header. See
     * that package's `upload-allowlists.ts` and #1230.
     */
    contentType: string,
    options?: SignedUploadOptions,
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
   * Upload content the API produced or fetched itself (as opposed to handing a
   * client a signed upload URL) — server-side report rendering, and the Discord
   * bot importer streaming an attachment out of Discord's CDN.
   *
   * A `ReadableStream` body is piped through, never buffered. That is not an
   * optimisation: the importer runs inside the API process alongside live
   * request traffic, and the archive bucket accepts objects up to 100 MB — one
   * buffered video is 100 MB the request path no longer has. Pass
   * {@link StreamUploadOptions.contentLength} whenever the source declared one,
   * so the upload sends a real `Content-Length` instead of falling back to
   * chunked transfer encoding.
   */
  uploadFile(
    bucket: string,
    path: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
    options?: StreamUploadOptions,
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
