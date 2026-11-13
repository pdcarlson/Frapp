/**
 * The no-AI half of the Documents folder import (#2242, step 4 of the plan in
 * #3642): what the device checks before anything uploads, and the tier-0
 * suggestion for each file (its folder from where it sat, its type and title
 * from its name). Pure, so the panel and its specs share one answer.
 *
 * Every suggestion is a starting value the officer reviews and can change
 * before Apply; nothing here files anything.
 */
import { inspectUploadFile, MAX_UPLOAD_LABEL } from "@repo/validation";
import {
  guessDocumentType,
  suggestFolder,
  titleFromFilename,
  typeKey,
} from "@/lib/documents/upload-defaults";

/** Why a file is left out at the check, before anything uploads. */
export type LeftOutReason =
  /** Not a type Documents accepts (a .zip, a video, an SVG). */
  | "type"
  /** Over the upload cap. */
  | "size";

/** A file that may need the officer before it's imported. */
export type DuplicateReason =
  /** The same bytes appear earlier in this import. */
  | "in-import"
  /** A document with the same file name and size is already in Documents. */
  | "in-library";

export const LEFT_OUT_LABEL: Record<LeftOutReason, string> = {
  type: "Not a type Documents takes",
  size: `Over ${MAX_UPLOAD_LABEL}`,
};

/** The device-side check of one file's type and size. */
export function checkImportFile(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true; contentType: string } | { ok: false; reason: LeftOutReason } {
  return inspectUploadFile("document", file);
}

/** A loose, case-free form of a file name, as storage keys mangle it. */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "_");
}

/**
 * The library document this file most likely already is: the same file name
 * (as stored) and the same size in bytes. Documents keep no content hash, so
 * this is a likeness, not proof, and the officer can import it anyway. A
 * document filed before sizes were recorded never matches.
 */
export function findInLibrary<
  D extends { title: string; storage_path: string; byte_size: number | null },
>(file: { name: string; size: number }, documents: readonly D[]): D | null {
  const key = nameKey(file.name);
  return (
    documents.find(
      (doc) =>
        doc.byte_size === file.size &&
        nameKey(doc.storage_path.slice(doc.storage_path.lastIndexOf("/") + 1)) ===
          key,
    ) ?? null
  );
}

/** The folders along a file's path, outermost first, without its name. */
export function folderSegments(path: string): string[] {
  return path.split("/").slice(0, -1).filter(Boolean);
}

/**
 * The Documents folder a file's path points at. Frapp's folders are one
 * level deep, so a tree is read from the inside out:
 *
 * - the deepest folder on the path that the chapter already has, matched
 *   ignoring case and punctuation ("treasurer/2025" files into an existing
 *   "Treasurer");
 * - else the first folder under the one that was dropped, as a new folder
 *   ("Chapter files/Rush/2025/flyer.pdf" goes to a new "Rush"), since the
 *   dropped folder is usually just the container;
 * - else, for a file sitting directly in the dropped folder, that folder;
 * - else (a loose file) nothing.
 */
export function folderFromPath(
  path: string,
  folders: readonly string[],
): { folder: string; isNew: boolean } | null {
  const segments = folderSegments(path);
  for (const segment of [...segments].reverse()) {
    const own = folders.find((folder) => typeKey(folder) === typeKey(segment));
    if (own) return { folder: own, isNew: false };
  }
  const pick = segments.length >= 2 ? segments[1] : segments[0];
  if (!pick) return null;
  return { folder: pick.trim().slice(0, FOLDER_NAME_MAX), isNew: true };
}

/** `CreateDocumentFolderDto.name`'s limit. */
const FOLDER_NAME_MAX = 100;

export type ImportSuggestion = {
  title: string;
  /** "" for no type. */
  documentType: string;
  /** "" for no folder. */
  folder: string;
  /** The suggested folder isn't one of the chapter's yet. */
  folderIsNew: boolean;
  /** Nothing in the name or the path said what type it is. */
  typeUnknown: boolean;
};

/**
 * The tier-0 suggestion for one file: the title from its name, the type from
 * its name or else from a folder on its path ("Minutes/10-12.docx" is
 * Minutes), and the folder from its path, or else from where the chapter
 * files that type.
 */
export function suggestForImport(
  path: string,
  context: {
    typeOptions: readonly string[];
    folders: readonly string[];
    documents: ReadonlyArray<{
      document_type: string | null;
      folder: string | null;
    }>;
  },
): ImportSuggestion {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const segments = folderSegments(path);
  let documentType = guessDocumentType(name, context.typeOptions);
  for (const segment of [...segments].reverse()) {
    if (documentType) break;
    documentType = guessDocumentType(segment, context.typeOptions);
  }
  const fromPath = folderFromPath(path, context.folders);
  const fromType =
    !fromPath && documentType
      ? suggestFolder(documentType, context.folders, context.documents)
      : null;
  return {
    title: titleFromFilename(name),
    documentType: documentType ?? "",
    folder: fromPath?.folder ?? fromType ?? "",
    folderIsNew: fromPath?.isNew ?? false,
    typeUnknown: documentType === null,
  };
}
