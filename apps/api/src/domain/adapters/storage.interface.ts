export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

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
}
