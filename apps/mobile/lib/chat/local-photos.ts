/**
 * The sender's own photos, kept on this device by the message that carries
 * them, so the thread draws them from the phone's files instead of waiting on
 * a signed link and downloading back what was just uploaded.
 *
 * Keyed by `client_message_id`, which the optimistic row and the confirmed
 * server row share. Memory only: after a relaunch the photos come from the
 * server like anyone else's. A picker's file can be cleaned up by the OS, so a
 * local image that fails to load falls back to the server copy
 * (`message-attachments.tsx`).
 */
export interface LocalPhoto {
  uri: string;
  width: number | null;
  height: number | null;
  /**
   * `filename|byte_size` of the claim this photo became, matched against the
   * server's attachment rows once they load. Null while the upload is still
   * running, when the pending row only needs the picture.
   */
  match: string | null;
}

const byMessage = new Map<string, LocalPhoto[]>();
/** Enough for a long session of sends without holding every URI forever. */
const MAX_MESSAGES = 200;

export function rememberLocalPhotos(
  clientMessageId: string,
  photos: LocalPhoto[],
): void {
  if (photos.length === 0) return;
  byMessage.delete(clientMessageId);
  byMessage.set(clientMessageId, photos);
  while (byMessage.size > MAX_MESSAGES) {
    const oldest = byMessage.keys().next().value;
    if (oldest === undefined) break;
    byMessage.delete(oldest);
  }
}

/** Fill in each photo's server match once its claim is known. */
export function matchLocalPhotos(
  clientMessageId: string,
  matches: (string | null)[],
): void {
  const photos = byMessage.get(clientMessageId);
  if (!photos) return;
  byMessage.set(
    clientMessageId,
    photos.map((photo, index) => ({
      ...photo,
      match: matches[index] ?? photo.match,
    })),
  );
}

export function forgetLocalPhotos(clientMessageId: string): void {
  byMessage.delete(clientMessageId);
}

export function localPhotosFor(
  clientMessageId: string | null | undefined,
): LocalPhoto[] | undefined {
  return clientMessageId ? byMessage.get(clientMessageId) : undefined;
}

/** The key a server attachment row is matched on. */
export function attachmentMatchKey(
  filename: string,
  byteSize: number | null | undefined,
): string {
  return `${filename}|${byteSize ?? ""}`;
}

/** Test seam: forget everything. */
export function clearLocalPhotosForTest(): void {
  byMessage.clear();
}
