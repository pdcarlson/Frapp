"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  displayNameOrNull,
  useDeleteDocument,
  useDocumentFolders,
  useDocuments,
  useMemberDisplayNames,
  useMyPermissions,
  useSemesters,
  type SemesterArchive,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { Can } from "@/components/shared/can";
import { PageActions } from "@/components/layout/page-actions";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { DocumentList } from "@/components/documents/document-list";
import {
  DOCUMENT_LIST_CAP,
  NO_DOCUMENT_FILTERS,
  isActiveDateFilter,
  queryDocuments,
  semesterSince,
  toLibraryDocuments,
  uploaderOptions,
  type DocumentFilters,
  type DocumentSort,
} from "@/components/documents/document-library";
import { DocumentViewer } from "@/components/documents/document-viewer";
import type {
  ChapterDocument,
  ChapterDocumentFolder,
  FolderRow,
} from "@/components/documents/document-types";
import {
  FolderDialog,
  useFolderManagement,
} from "@/components/documents/folder-management";
import { FolderRail } from "@/components/documents/folder-rail";
import {
  DocumentsPageDropTarget,
  UploadDocumentPanel,
  useDocumentUpload,
} from "@/components/documents/upload-document-panel";
import { documentTypeOptions } from "@/lib/documents/upload-defaults";
import { useNetwork } from "@/lib/providers/network-provider";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useToast } from "@/lib/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

/*
  Keyed by chapter, so switching chapters starts the page over: the upload
  draft (file, folder, guesses) and the folder on screen belong to the chapter
  they were made in and must never be offered to the next one.
*/
export function DocumentsPage() {
  const chapterId = useChapterStore((state) => state.activeChapterId);
  return <ChapterDocumentsPage key={chapterId ?? "none"} />;
}

function ChapterDocumentsPage() {
  const { toast } = useToast();
  // Every write route on `ChapterDocumentController` (upload URL, confirm,
  // delete) carries no `@FreeTier`, so they are all paid-ops behind the same
  // subscription guard — one gate covers the surface (#841).
  const gate = useSubscriptionGate();
  const { isOffline } = useNetwork();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [search, setSearch] = useState("");
  /*
    Search, the uploader and date filters, and the order all run here, over
    the library the list endpoint returns in one response (#3852), as
    `/backwork`'s do: a keystroke re-ranks what is in memory, so there is no
    request per character, and it works offline over what is loaded. Deferred
    so a long library re-ranks behind the keystroke rather than ahead of it.
  */
  const deferredSearch = useDeferredValue(search.trim());
  const [filters, setFilters] = useState<DocumentFilters>(NO_DOCUMENT_FILTERS);
  const [sort, setSort] = useState<DocumentSort>("name");
  const documentsQuery = useDocuments();
  const foldersQuery = useDocumentFolders();
  const deleteDoc = useDeleteDocument();

  const documents = useMemo(
    () => asArray<ChapterDocument>(documentsQuery.data),
    [documentsQuery.data],
  );
  /*
    Uploaders by name, from the roster chat already caches. A name the roster
    can't resolve (a member who has left, or a roster still loading) is left
    off the row and out of the Uploaded by menu rather than shown as an id.
  */
  const { byId: namesById } = useMemberDisplayNames();
  const library = useMemo(
    () =>
      toLibraryDocuments(documents, (userId) =>
        displayNameOrNull(namesById[userId]),
      ),
    [documents, namesById],
  );
  // A picked uploader the roster no longer names (they left the chapter) is
  // dropped rather than left filtering under a raw id nobody can see. One the
  // roster still names stays picked even with no files left, and stays in the
  // menu, so the list says nothing matches rather than quietly widening.
  const pickedName =
    filters.uploader === null ? null : displayNameOrNull(namesById[filters.uploader]);
  const uploader = pickedName === null ? null : filters.uploader;
  const uploaders = useMemo(() => {
    const options = uploaderOptions(library);
    if (uploader !== null && pickedName !== null && !options.some((o) => o.value === uploader)) {
      options.push({ value: uploader, label: pickedName });
    }
    return options;
  }, [library, uploader, pickedName]);
  const effectiveFilters = useMemo(
    () => ({ ...filters, uploader }),
    [filters, uploader],
  );
  /*
    "This semester" is the chapter's own: since its last rollover
    (`semesterSince`). The clock ticks each minute so "Last 30 days" and the
    semester line move while the page stays open.
  */
  const semestersQuery = useSemesters();
  // `undefined` until the archives load: unknown, never "no rollover yet".
  const since = useMemo(
    () =>
      semestersQuery.data === undefined
        ? undefined
        : semesterSince(asArray<SemesterArchive>(semestersQuery.data)),
    [semestersQuery.data],
  );
  const [now, setNow] = useState(() => new Date());

  /*
    From `GET /v1/documents/folders`, not derived over `documents` (#791).
    Deriving could only ever see folders some document is currently filed
    under, so a freshly created folder — and one whose last document was
    deleted — was invisible, and the officer-set `sort_order` was ignored
    entirely in favour of an alphabetical sort.

    Sorted client-side as well even though the endpoint already returns display
    order: this list is re-rendered optimistically against a reorder that is
    still in flight, and `sort_order` is the field being changed.
  */
  const folders = useMemo(() => {
    return asArray<ChapterDocumentFolder>(foldersQuery.data)
      .filter((folder) => !!folder?.id && !!folder?.name)
      .sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          a.name.localeCompare(b.name),
      );
  }, [foldersQuery.data]);

  /*
    What the rail actually renders.

    The folder list is now its own request, which means it can fail on its own —
    a state that could not exist while the list was derived from the documents
    already in hand. Failing to [] would be the worst answer: the rail would
    quietly claim the chapter has no folders while document rows keep printing
    `· Governance` in their meta line, promising a tab that isn't there.

    So on error we fall back to exactly the pre-#791 behaviour, deriving names
    from the loaded documents. Those entries carry no `id`, which is precisely
    right — without a folder record there is nothing to rename, reorder or
    delete, and the management controls key on `id` being present.

    It derives from the whole library, never what the search or filters
    leave showing, so a folder tab doesn't vanish as someone types (#3852
    made the list unfiltered on the wire, which removed the case that once
    needed a guard here).
  */
  const railFolders = useMemo<FolderRow[]>(() => {
    if (!foldersQuery.isError) return folders;
    const names = new Set<string>();
    for (const doc of documents) {
      if (doc.folder) names.add(doc.folder);
    }
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ id: null, name, sort_order: null }));
  }, [folders, foldersQuery.isError, documents]);

  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  // The document open in the viewer (#3849), by id: the viewer reads the row
  // from `visible`, so it steps through the list as shown and closes when the
  // row leaves it.
  const [openId, setOpenId] = useState<string | null>(null);
  // The clock pauses while a document is open: a window moving past the
  // open file would drop its row and close the viewer mid-read. It catches up
  // as soon as the viewer closes.
  useEffect(() => {
    if (openId !== null) return;
    const catchUp = setTimeout(() => setNow(new Date()), 0);
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearTimeout(catchUp);
      clearInterval(timer);
    };
  }, [openId]);
  const { data: permissionsPayload } = useMyPermissions();
  const canUpload = can(
    "chapter_docs:upload",
    permissionsPayload?.permissions ?? [],
  );

  /*
    The folder tab, then the toolbar's search, filters and order
    (`queryDocuments`). All of it is local, so switching folders or typing is
    instant.
  */
  const inFolder = useMemo(
    () =>
      activeFolder === null
        ? library
        : library.filter((row) =>
            activeFolder === ""
              ? !row.doc.folder
              : row.doc.folder === activeFolder,
          ),
    [activeFolder, library],
  );
  const visible = useMemo(
    () =>
      queryDocuments(inFolder, deferredSearch, effectiveFilters, sort, {
        now,
        semesterSince: since,
      }),
    [inFolder, deferredSearch, effectiveFilters, sort, now, since],
  );
  const visibleDocs = useMemo(() => visible.map((row) => row.doc), [visible]);
  const filtering =
    !!deferredSearch ||
    uploader !== null ||
    isActiveDateFilter(filters.date, since !== undefined);
  // A response at PostgREST's row cap may be missing older files.
  const truncated = documents.length >= DOCUMENT_LIST_CAP;

  /*
    The upload panel's type chips: the common types plus every type this
    chapter has already filed under, read off the documents in hand. Free text
    on the wire until #3642, so this keeps new uploads on the spellings the
    library already uses.
  */
  const typeOptions = useMemo(
    () => documentTypeOptions(documents.map((doc) => doc.document_type)),
    [documents],
  );
  const folderNames = useMemo(
    () => folders.map((folder) => folder.name),
    [folders],
  );
  const upload = useDocumentUpload(gate, {
    activeFolder,
    typeOptions,
    folders: folderNames,
    documents,
  });
  /*
    Which rows' deletes are in flight — a set, not a scalar. `useDeleteDocument` is pessimistic —
    the row only disappears once the DELETE round-trips — so without this
    the row's button stays enabled across the whole request. That is a
    second-delete hazard, and it also defeats `confirm-dialog.tsx`'s focus
    guard: the confirmation returns focus to the opener once its ~200ms exit
    ends, usually before the request settles, so focus landed on a control that then
    unmounted and dropped to `<body>`. Marked disabled before the await, the
    guard sees `[disabled]` and sends focus to `#main-content` instead —
    which is the fallback it exists for.
  */
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const folderManagement = useFolderManagement({
    gate,
    folders,
    activeFolder,
    setActiveFolder,
    confirm,
    refetchFolders: foldersQuery.refetch,
  });

  async function handleDelete(doc: ChapterDocument) {
    // README §2 bans `window.confirm` on *every* surface, and §9 specs the
    // replacement. No comment is collected, so this is the truthiness form —
    // the `null`-vs-`""` distinction only matters where a `comment` is asked
    // for, as it is on the two Chapter Ops rejection flows.
    const confirmed = await confirm({
      title: `Delete ${doc.title}?`,
      description:
        "This removes the file from chapter storage immediately and cannot be undone.",
      confirmLabel: "Delete document",
      tone: "destructive",
    });
    if (!confirmed) return;
    setDeletingIds((current) => new Set(current).add(doc.id));
    try {
      await deleteDoc.mutateAsync(doc.id);
      toast({
        title: "Document removed",
        description: `${doc.title} was deleted.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't delete document",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(doc.id);
        return next;
      });
    }
  }

  /*
    These used to be early returns above everything, which meant a background
    refetch failure unmounted the `Can`-gated upload `Dialog` mid-draft — the
    hazard `subscription-gate.tsx` names for `useGatedDialog` ("a surface can
    unmount its dialog subtree ... while `open` is still true"), and the same
    shape the Chapter Ops slice hit with `{confirmDialog}`. The header, the
    dialog and the notice now always render, and the states scope to the list
    they describe.

    `useDocuments` has no `enabled` gate, so `isPending` is honest here — but
    it is also true for a *paused* query, which is why an offline member with
    no cached documents sat on "Loading chapter documents..." indefinitely.
    The offline branch answers README §4 item 4.

    It is gated on there being nothing loaded, and that qualifier is
    load-bearing. README §4 scopes the offline treatment to "offline, **no
    cached data**", and §10 says background refetches keep stale content in
    place — so replacing a library already in hand with an "unavailable
    offline" card on a WiFi blip would discard what the member can still read.
    Being offline *with* content is the shell's `ConnectionPill`'s job; it
    renders on every route already, so the screen owes a state only when it
    has nothing else to say. Gated on `documents`, not `visible`: a folder
    filter that matches nothing is the empty case, not the offline one.
  */
  const listState =
    isOffline && documents.length === 0
      ? "offline"
      : documentsQuery.isPending
        ? "loading"
        : documentsQuery.isError
          ? "error"
          : visible.length === 0
            ? "empty"
            : "ready";

  return (
    <div className="space-y-6">
      <PageActions>
        <Can permission="chapter_docs:upload">
          <UploadDocumentPanel
            gate={gate}
            upload={upload}
            folders={folderNames}
            typeOptions={typeOptions}
          />
          <DocumentsPageDropTarget
            gate={gate}
            upload={upload}
            activeFolder={activeFolder}
          />
        </Can>
      </PageActions>
      {/*
        The page-narration paragraph that sat here is deleted, not restyled.
        The framework board lists "page-narration paragraphs" under Removed
        outright, and `1f` pin 2 gives a route's main pane one toolbar row with
        "no wrapper card, no description paragraph".

        Nothing in it was load-bearing. "Organizational files, bylaws,
        constitutions, meeting agendas" described a library the member is
        looking at; "every chapter member can download" restated the absence of
        a gate; "upload and delete are permission-gated" was narration about
        controls that are already absent for a member who lacks the permission,
        which is what `Can` is for.
      */}

      {/*
        Disable, don't hide (§5 rule 4): browsing and downloading stay live for
        a lapsed chapter, so the library keeps working — only the writes stop,
        and this says why.
      */}
      {/*
        Scoped to the union of the two permissions that own the gated controls.
        A plain member browsing a fully readable library holds neither, so the
        notice would describe controls they cannot see.
      */}
      {/*
        Silent on purpose, and the only three gates that are. This wraps a
        `SubscriptionNotice` — an explanation of why *another* control is
        disabled — not an affordance. There is nothing here for a member to act
        on, so a second notice saying we cannot check their access states a
        problem about a sentence rather than about anything they can do, and
        stacks a duplicate of the chip the gated control already shows. §5 rule
        4's "disable, don't hide" is about controls; supplementary copy has
        nothing to disable. `can-fallback.spec.tsx` derives this rather than
        listing it: a lone `SubscriptionNotice` child both may and must be
        `null` here.
      */}
      <Can
        anyOf={["chapter_docs:upload", "chapter_docs:manage"]}
        offlineFallback={null}
      >
        <SubscriptionNotice gate={gate} feature="managing documents" />
      </Can>

      {/*
        Flush, not carded. Two `<Card>`s used to sit here, one per column, so
        the rail and the list each paid a hairline, 24px of padding and a title
        block to say what a 220px column beside a list of files already says.
        The board's page body is the surface itself (`1f` pin 2: "no wrapper
        card"), and what survives of each card is its heading — as the section
        label §2 draws above a grouped list, which is what both of these are.

        200px rather than the old 240: the rail holds folder names and a four
        control management row, and the width it was giving up was the list's.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 md:grid-cols-[200px_minmax(0,1fr)]">
        <FolderRail
          railFolders={railFolders}
          activeFolder={activeFolder}
          setActiveFolder={setActiveFolder}
          gate={gate}
          management={folderManagement}
          loadFailed={foldersQuery.isError}
          onRetryLoad={() => void foldersQuery.refetch()}
        />

        <DocumentList
          listState={listState}
          loadError={documentsQuery.error}
          visible={visible}
          activeFolder={activeFolder}
          total={inFolder.length}
          truncated={truncated}
          filtering={filtering}
          search={search}
          setSearch={setSearch}
          deferredSearch={deferredSearch}
          filters={effectiveFilters}
          semesterKnown={since !== undefined}
          setFilters={setFilters}
          uploaders={uploaders}
          sort={sort}
          setSort={setSort}
          onClearFilters={() => {
            setSearch("");
            setFilters(NO_DOCUMENT_FILTERS);
          }}
          onRetry={() => void documentsQuery.refetch()}
          gate={gate}
          deletingIds={deletingIds}
          onOpen={(doc) => setOpenId(doc.id)}
          onDelete={(doc) => void handleDelete(doc)}
          onShowAllFiles={() => setActiveFolder(null)}
          onUpload={canUpload ? () => upload.openPanel() : undefined}
        />
      </div>
      {/*
        Rendered last and unconditionally, for the reason `DocumentList`'s states
        no longer are: an offline or error branch that sits over this would
        unmount a pending confirmation without settling its promise, leaving
        `await confirm(...)` hanging forever. That is the two-change
        interaction the Chapter Ops slice shipped and its guard caught.
      */}
      <FolderDialog gate={gate} management={folderManagement} />
      <DocumentViewer
        documents={visibleDocs}
        openId={openId}
        onOpenChange={setOpenId}
      />

      {confirmDialog}
    </div>
  );
}
