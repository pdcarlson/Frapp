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
  ): Promise<string>;
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
