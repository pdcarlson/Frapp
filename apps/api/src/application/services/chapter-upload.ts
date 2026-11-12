import { BadRequestException } from '@nestjs/common';
import {
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
  MAX_UPLOAD_LABEL,
  type UploadKind,
} from '@repo/validation';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import { safeObjectFilename } from '#domain/constants/storage';
import { isUnsafeStoragePath } from '#domain/utils/storage-path';

/**
 * The upload-first proof flow service hours introduced
 * (`spec/behavior/service-hours.md` § Logging) and task photos reuse (#4565):
 * the client asks for a signed upload URL under a server-minted, chapter-bound
 * prefix, PUTs the bytes, then sends the returned storage path on its write,
 * which re-checks the path here before persisting it. One copy, so a fix to
 * either half reaches both features.
 */

/**
 * Refuse an upload request whose file the kind doesn't allow, before any URL
 * is minted. This gates issuance only: a signed upload URL can't pin a content
 * type, so the bucket's own `allowed_mime_types` / `file_size_limit` are what
 * hold on the upload itself.
 */
export function assertUploadRequestAllowed(
  kind: UploadKind,
  input: { filename: string; contentType: string; sizeBytes?: number },
): void {
  const ext = input.filename.includes('.')
    ? input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase()
    : '';
  if (!isAllowedUploadExtension(kind, ext)) {
    throw new BadRequestException('File extension is not allowed');
  }
  if (!isAllowedUploadMime(kind, input.contentType)) {
    throw new BadRequestException(
      `Content type "${input.contentType}" is not allowed`,
    );
  }
  if (
    input.sizeBytes !== undefined &&
    !isWithinUploadSizeLimit(input.sizeBytes)
  ) {
    throw new BadRequestException(
      `File exceeds the ${MAX_UPLOAD_LABEL} upload limit`,
    );
  }
}

/**
 * Mint a fresh object key under `prefix` (trailing slash included) and a
 * signed upload URL for it. The id is generated before the row exists, since
 * the file is uploaded first and attached on the write.
 */
export async function mintChapterUpload(
  storage: IStorageProvider,
  bucket: string,
  prefix: string,
  input: { filename: string; contentType: string },
): Promise<{ signedUrl: string; storagePath: string; uploadId: string }> {
  const uploadId = crypto.randomUUID();
  const storagePath = `${prefix}${uploadId}/${safeObjectFilename(input.filename)}`;
  const signedUrl = await storage.getSignedUploadUrl(
    bucket,
    storagePath,
    input.contentType,
  );
  return { signedUrl, storagePath, uploadId };
}

/**
 * A client-echoed upload path, checked before it is persisted: it must sit
 * under the chapter's `prefix` (no `.`/`..`/empty segments, which would let a
 * prefix-passing string escape the folder) and must name an object that was
 * actually uploaded — a fabricated key would otherwise hand a reader a link
 * that can never resolve, or another feature's object.
 */
export async function assertUploadedPathUnder(
  storage: IStorageProvider,
  bucket: string,
  prefix: string,
  path: string,
  messages: { outsidePrefix: string; missing: string; field: string },
): Promise<void> {
  const segments = path.split('/');
  if (
    !path.startsWith(prefix) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new BadRequestException(messages.outsidePrefix);
  }
  // The literal-segment check above misses the percent-encoded and
  // control-character spellings, so run the shared helper too. It runs
  // second so a plainly wrong path keeps its more helpful message.
  if (isUnsafeStoragePath(path)) {
    throw new BadRequestException(
      `${messages.field} must not contain relative path segments`,
    );
  }

  const folder = path.slice(0, path.lastIndexOf('/'));
  const uploaded = await storage.listFiles(bucket, folder);
  if (!uploaded.includes(path)) {
    throw new BadRequestException(messages.missing);
  }
}
