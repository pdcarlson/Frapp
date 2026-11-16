/**
 * Opening a library document on the phone (#4409): s12 downloads the file and
 * hands it to the system share sheet, where the member previews it, saves it
 * to Files, or opens it in another app, as Slack, Drive, Dropbox and Teams do
 * with a member's upload.
 *
 * It used to open the inline `downloadUrl` in the in-app browser, the one
 * place a member's file was served inline as a page. Chat's trust rule says
 * nothing member-uploaded ever is (`spec/behavior/chat/README.md` § File and
 * image uploads), and the bucket gates the declared type, never the bytes, so
 * the owner chose to keep the rule without an exception
 * (`spec/behavior/chapter-docs.md` § Two links).
 */
import { selectDownloadUrl, selectForcedDownloadUrl } from "@repo/hooks";
import {
  contentTypeByExtension,
  fileExtension,
  isAllowedUploadExtension,
} from "@repo/validation";
import { safeFileStem, shareRemoteFile } from "@/lib/share-remote-file";
import { str } from "./narrow";

/** The `document` kind's types, each to the first extension that names it. */
const EXTENSION_BY_TYPE: ReadonlyMap<string, string> = (() => {
  const byType = new Map<string, string>();
  for (const [extension, type] of Object.entries(
    contentTypeByExtension("document"),
  )) {
    if (!byType.has(type)) byType.set(type, extension);
  }
  return byType;
})();

function baseType(contentType: string | null): string | null {
  if (!contentType) return null;
  return contentType.split(";")[0]!.trim().toLowerCase();
}

/**
 * The name the downloaded file gets, with the type an app receiving it should
 * read it as, or `null` when the document's type isn't one the library takes.
 *
 * The extension follows the declared type when it is on the `document` upload
 * list (`@repo/validation`), else the stored file's own extension when that
 * is on the list (an older row with no useful type, as the File type filter
 * reads it). Either way it can only name a PDF, image, Office or text file:
 * an app receiving the file types it by its extension (iOS ignores a MIME
 * type), so a page can never arrive as one. The stem is the stored filename,
 * the name web's Download saves under, else the title.
 */
export function documentFile(
  payload: unknown,
): { name: string; mimeType: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storedName = str(row, "storage_path")?.split("/").pop() ?? "";

  const declared = baseType(str(row, "content_type"));
  let extension = declared ? EXTENSION_BY_TYPE.get(declared) : undefined;
  let mimeType = declared;
  if (!extension) {
    const stored = fileExtension(storedName);
    if (!stored || !isAllowedUploadExtension("document", stored)) return null;
    extension = stored;
    mimeType = contentTypeByExtension("document")[stored] ?? null;
  }
  if (!mimeType) return null;

  const stem =
    safeFileStem(storedName) || safeFileStem(str(row, "title") ?? "");
  return { name: `${stem || "document"}.${extension}`, mimeType };
}

/**
 * Downloads the document a `GET /v1/documents/{id}` read returned and presents
 * the share sheet. False when there was nothing to open or it couldn't be
 * downloaded or shared, for s12 to say so.
 *
 * It downloads `forcedDownloadUrl`, falling back to the inline `downloadUrl`
 * on a server that predates it: a download writes the bytes to disk either
 * way, so neither is ever shown as a page here.
 */
export async function shareDocumentFile(
  id: string,
  payload: unknown,
  shouldPresent: () => boolean,
): Promise<boolean> {
  const url = selectForcedDownloadUrl(payload) ?? selectDownloadUrl(payload);
  const file = documentFile(payload);
  if (!url || !file) return false;
  const title = str(payload as Record<string, unknown>, "title");
  return shareRemoteFile(
    { key: id, url, name: file.name, mimeType: file.mimeType },
    {
      folder: "documents",
      dialogTitle: title ?? "Open document",
      shouldPresent,
    },
  );
}
