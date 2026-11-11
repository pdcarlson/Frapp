"use client";

import { useEffect, useMemo, useState } from "react";
import { displayNameOrNull } from "./display-names";
import {
  DOCUMENT_LIST_CAP,
  isFiltering,
  kindOptions,
  queryDocuments,
  semesterSince,
  toLibraryDocuments,
  uploaderOptions,
  type DocumentFilters,
  type DocumentSort,
  type FileKind,
  type LibraryDocument,
  type LibrarySourceDocument,
  type UploaderOption,
} from "./document-library";
import type { MemberDisplayNames } from "./use-members";

export type DocumentLibrary<D extends LibrarySourceDocument> = {
  /** Every document, uploader resolved, in the order it arrived. */
  library: LibraryDocument<D>[];
  /** How many documents the folder holds, before search and filters. */
  folderTotal: number;
  /** The folder, then the search, filters and order, applied. */
  visible: LibraryDocument<D>[];
  /** The Uploaded by choices (`uploaderOptions`, plus a kept pick). */
  uploaders: UploaderOption[];
  /** The File type choices: groups some document is in, plus a kept pick. */
  kinds: { value: FileKind; label: string }[];
  /**
   * `filters` as applied: an uploader the roster no longer names is dropped,
   * so a control shows it unpicked rather than filtering under a raw id.
   */
  filters: DocumentFilters;
  /** The chapter's semester archives have loaded, so "This semester" means something. */
  semesterKnown: boolean;
  /** A search or a filter is narrowing the list. */
  filtering: boolean;
  /** The response sat at the row cap, so older files may be missing. */
  truncated: boolean;
};

/**
 * The Documents library as a screen shows it, for web `/documents` and mobile
 * s12 alike (#3938): `document-library.ts`'s pure rules plus the parts that
 * need React, so the two apps can't drift on them.
 *
 * - Uploaders are named from the roster chat already caches. A pick the
 *   roster no longer names (they left) is dropped; one it still names stays
 *   picked, and stays a choice, after their last file goes, so the list says
 *   nothing matches rather than quietly widening.
 * - "This semester" reads the chapter's archives, unknown until they load.
 * - The clock ticks each minute, so "Last 30 days" and the semester line move
 *   while the screen stays open. `paused` holds it (web's viewer, where a
 *   window moving past the open file would close it mid-read).
 * - `folder` is a folder's name, `""` for documents in no folder, or `null`
 *   for all of them.
 *
 * The caller passes the roster (`useMemberDisplayNames().byId`) and the
 * archives (`useSemesters().data`, `undefined` while loading) rather than this
 * hook reading them, so a screen's spec that mocks `@repo/hooks` reaches them.
 */
export function useDocumentLibrary<D extends LibrarySourceDocument>({
  documents,
  folder,
  search,
  filters,
  sort,
  namesById,
  semesters,
  starred,
  paused = false,
}: {
  documents: readonly D[];
  namesById: MemberDisplayNames["byId"];
  /** `useSemesters().data`: `undefined` while the archives load. */
  semesters: unknown;
  folder: string | null;
  search: string;
  filters: DocumentFilters;
  sort: DocumentSort;
  /** The ids of the files this member starred, for the Starred filter (#4290). */
  starred?: ReadonlySet<string>;
  paused?: boolean;
}): DocumentLibrary<D> {
  const library = useMemo(
    () =>
      toLibraryDocuments(documents, (userId) =>
        displayNameOrNull(namesById[userId]),
      ),
    [documents, namesById],
  );

  const pickedName =
    filters.uploader === null
      ? null
      : displayNameOrNull(namesById[filters.uploader]);
  const uploader = pickedName === null ? null : filters.uploader;
  const uploaders = useMemo(() => {
    const options = uploaderOptions(library);
    if (
      uploader !== null &&
      pickedName !== null &&
      !options.some((option) => option.value === uploader)
    ) {
      options.push({ value: uploader, label: pickedName });
    }
    return options;
  }, [library, uploader, pickedName]);
  // A picked group whose last file went stays a choice, as an uploader does,
  // so the list says nothing matches rather than the chip vanishing.
  const kinds = useMemo(
    () =>
      kindOptions([
        ...library.map((row) => row.kind),
        ...(filters.kind === null ? [] : [filters.kind]),
      ]),
    [library, filters.kind],
  );
  const applied = useMemo(
    () => ({ ...filters, uploader }),
    [filters, uploader],
  );

  // `undefined` until the archives load: unknown, never "no rollover yet".
  const since = useMemo(
    () =>
      semesters === undefined
        ? undefined
        : semesterSince(asArchives(semesters)),
    [semesters],
  );

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (paused) return;
    const catchUp = setTimeout(() => setNow(new Date()), 0);
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearTimeout(catchUp);
      clearInterval(timer);
    };
  }, [paused]);

  const inFolder = useMemo(
    () =>
      folder === null
        ? library
        : library.filter((row) =>
            folder === "" ? !row.doc.folder : row.doc.folder === folder,
          ),
    [library, folder],
  );
  const visible = useMemo(
    () =>
      queryDocuments(inFolder, search, applied, sort, {
        now,
        semesterSince: since,
        starred,
      }),
    [inFolder, search, applied, sort, now, since, starred],
  );

  return {
    library,
    folderTotal: inFolder.length,
    visible,
    uploaders,
    kinds,
    filters: applied,
    semesterKnown: since !== undefined,
    filtering: isFiltering(search, applied, since !== undefined),
    truncated: documents.length >= DOCUMENT_LIST_CAP,
  };
}

/** `GET /v1/semesters` is untyped at the wire (`use-semesters.ts`). */
function asArchives(
  data: unknown,
): { end_date: string; created_at?: string }[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (row): row is { end_date: unknown; created_at?: unknown } =>
        !!row && typeof row === "object",
    )
    .map((row) => ({
      end_date: typeof row.end_date === "string" ? row.end_date : "",
      created_at:
        typeof row.created_at === "string" ? row.created_at : undefined,
    }));
}
