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
}
