/**
 * Opening a library document on the phone (#4409): s12 downloads the file and
 * hands it to the system share sheet, where the member saves it to Files or
 * opens it in an app that reads it. Slack, Drive, Dropbox and Teams likewise
 * never open a member's upload as a web page on the phone.
 *
 * It used to open the inline `downloadUrl` in the in-app browser, the one
 * place a member's file was served inline as a page. Chat's trust rule says
 * nothing member-uploaded ever is (`spec/behavior/chat/README.md` § File and
 * image uploads), and the bucket gates the declared type, never the bytes, so
 * the owner chose to keep the rule without an exception
 * (`spec/behavior/chapter-docs.md` § Two links).
 */
import { selectDownloadUrl, selectForcedDownloadUrl } from "@repo/hooks";
import { classifyFile } from "@repo/hooks/document-library";
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

/**
 * The name the downloaded file gets, with the type an app receiving it should
 * read it as, or `null` when the document's type isn't one the library takes.
 *
 * The type is the one the library groups and names the file by
 * (`classifyFile`'s `groupType`: the declared type, or the stored extension's
 * when the declared one is absent or unrecognised), so a `.csv` declared
 * `text/plain` saves as the CSV its tile says it is. Its extension comes from
 * the `document` upload list (`@repo/validation`), else the stored file's own
 * extension when that is on the list: either way it can only name a PDF,
 * image, Office or text file. An app receiving the file types it by its
 * extension (iOS ignores a MIME type), so a page can never arrive as one.
 *
 * The stem is the stored filename made safe to be one path segment, else the
 * title. That is close to, not exactly, the name web's Download saves under:
 * `Q&A (draft).pdf` arrives as `Q_A_draft.pdf`.
 */
export function documentFile(
  payload: unknown,
): { name: string; mimeType: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const storagePath = str(row, "storage_path");
  const storedName = storagePath?.split("/").pop() ?? "";

  const { groupType } = classifyFile({
    content_type: str(row, "content_type"),
    storage_path: storagePath,
  });
  let extension = groupType ? EXTENSION_BY_TYPE.get(groupType) : undefined;
  let mimeType = groupType;
  if (!extension) {
    const stored = fileExtension(storedName);
    if (!isAllowedUploadExtension("document", stored)) return null;
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
