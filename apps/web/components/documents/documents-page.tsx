"use client";

import {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  useDeleteDocument,
  useDocumentFolders,
  useDocumentLibrary,
  useMarkFilterHold,
  useDocuments,
  useMemberDisplayNames,
  useMyPermissions,
  useSemesters,
  useDocumentTypes,
  type DocumentTypeRow,
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
  DELETE_DOCUMENT_BODY,
  DELETE_DOCUMENT_LABEL,
  NO_DOCUMENT_FILTERS,
  deleteDocumentTitle,
  markedItems,
  tierRows,
  type DocumentFilters,
  type DocumentSort,
} from "@repo/hooks/document-library";
import { DocumentViewer } from "@/components/documents/document-viewer";
import { DOCUMENT_LINK_PARAM } from "@/components/ask/ask-source-link";
import type {
  ChapterDocument,
  ChapterDocumentFolder,
  FolderRow,
} from "@/components/documents/document-types";
import {
  FolderDialog,
  useFolderManagement,
} from "@/components/documents/folder-management";
import { FolderImportPanel } from "@/components/documents/folder-import-panel";
import { FolderRail } from "@/components/documents/folder-rail";
import { MarkedStrip } from "@/components/documents/marked-strip";
import { useDocumentMarks } from "@/components/documents/use-document-marks";
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
    Search, the uploader, date, file type, Pinned and Starred filters, and the order all run
    here (`useDocumentLibrary`), over
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
  /*
    What opened the viewer, so closing goes back to it: a pinned or starred
    file is both a card and a row on All files (#3934), and the viewer's own
    lookup by document would always find the card first.
  */
  const viewerOpener = useRef<HTMLElement | null>(null);
  function openDocument(doc: ChapterDocument) {
    viewerOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setOpenId(doc.id);
  }
  const { data: permissionsPayload } = useMyPermissions();
  const canUpload = can(
    "chapter_docs:upload",
    permissionsPayload?.permissions ?? [],
  );

  /*
    The folder tab, then the toolbar's search, filters and order, all local,
    through the hook mobile's s12 runs too (#3938): uploader names and the
    kept-pick rule, the semester window, and the clock. The clock pauses
    while a document is open: a window moving past the open file would drop
    its row and close the viewer mid-read. It catches up when it closes.
  */
  // Pins and the member's stars (#3934); the stars feed the Starred filter.
  const marks = useDocumentMarks();
  /*
    Under Pinned or Starred (#4290), a row the member just unmarked stays
    until the filter changes, and so does the file open in the viewer: a mark
    changing under it (an officer's unpin, a star rolled back, another tab)
    would otherwise drop the row and close the viewer mid-read, which the
    clock's pause can't prevent.
  */
  const { held, hold } = useMarkFilterHold(filters.marks);
  const keep = useMemo(
    () => (openId === null ? held : new Set([...held, openId])),
    [held, openId],
  );
  const {
    folderTotal,
    visible,
    uploaders,
    kinds,
    filters: effectiveFilters,
    semesterKnown,
    filtering,
    truncated,
  } = useDocumentLibrary({
    documents,
    folder: activeFolder,
    search: deferredSearch,
    filters,
    sort,
    namesById: useMemberDisplayNames().byId,
    semesters: useSemesters().data,
    starred: marks.starred.documents,
    keep,
    paused: openId !== null,
  });
  /*
    Pinned and starred (#3934, `chapter-docs.md` § Pinned and starred). On
    the unfiltered All files view the two tiers are cards above the list
    (`MarkedStrip`), and the list keeps its plain order; anywhere else (a
    folder, a search, a filter) they lead the list itself. Either way they
    come first, and nothing is drawn twice on one screen.
  */
  const showStrip =
    activeFolder === null && !filtering && deferredSearch === "";
  // The tiers and the cards come from the builders mobile's s12 uses too
  // (`@repo/hooks/document-library`), so the two apps can't disagree.
  const { starred: starredIds } = marks;
  const tieredVisible = useMemo(
    () => (showStrip ? visible : tierRows(visible, starredIds.documents)),
    [visible, showStrip, starredIds],
  );
  const strip = useMemo(
    () =>
      markedItems({
        folders,
        library: documents,
        shown: visible.map((row) => row.doc),
        starredFolders: starredIds.folders,
        starredDocuments: starredIds.documents,
      }),
    [documents, folders, visible, starredIds],
  );
  const visibleDocs = useMemo(
    () => tieredVisible.map((row) => row.doc),
    [tieredVisible],
  );

  /*
    The upload panel's type chips: the chapter's own list of document types
    (#3642). Until that list has loaded, or when it can't be read, the common
    types plus every type the documents in hand already use, so the panel still
    offers the spellings the library has.
  */
  const typesQuery = useDocumentTypes();
  const typeRows = useMemo(
    () => asArray<DocumentTypeRow>(typesQuery.data),
    [typesQuery.data],
  );
  const typeOptions = useMemo(
    () =>
      typesQuery.isSuccess
        ? typeRows.map((type) => type.name)
        : documentTypeOptions(documents.map((doc) => doc.document_type)),
    [typesQuery.isSuccess, typeRows, documents],
  );
  const canManageTypes = can(
    "chapter_docs:manage",
    permissionsPayload?.permissions ?? [],
  );
  const folderNames = useMemo(
    () => folders.map((folder) => folder.name),
    [folders],
  );
  const importContext = useMemo(
    () => ({ typeOptions, folders: folderNames, documents }),
    [typeOptions, folderNames, documents],
  );
  const upload = useDocumentUpload(gate, {
    activeFolder,
    typeOptions,
    folders: folderNames,
    documents,
    canUpload,
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
      title: deleteDocumentTitle(doc.title),
      description: DELETE_DOCUMENT_BODY,
      confirmLabel: DELETE_DOCUMENT_LABEL,
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
    // A container (#4022): beside chat (#3779) the page is narrow while the
    // window is wide, so the folder rail counts the page's own width.
    <div className="@container space-y-6">
      <PageActions>
        <Can permission="chapter_docs:upload">
          <UploadDocumentPanel
            gate={gate}
            upload={upload}
            folders={folderNames}
            typeOptions={typeOptions}
            typeRows={typesQuery.isSuccess && canManageTypes ? typeRows : null}
          />
          <FolderImportPanel gate={gate} context={importContext} />
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 @2xl:grid-cols-[200px_minmax(0,1fr)]">
        <FolderRail
          railFolders={railFolders}
          activeFolder={activeFolder}
          setActiveFolder={setActiveFolder}
          gate={gate}
          management={folderManagement}
          marks={marks}
          loadFailed={foldersQuery.isError}
          onRetryLoad={() => void foldersQuery.refetch()}
        />

        <div className="min-w-0 space-y-6">
          {/*
          Also over an empty library: a folder pinned before anything is filed
          still gets its card. Not over the loading, error or offline states,
          which have nothing to say about the cards.
        */}
        {showStrip && (listState === "ready" || listState === "empty") ? (
            <MarkedStrip
              pinned={strip.pinned}
              starred={strip.starred}
              marks={marks}
              gate={gate}
              onOpenFolder={setActiveFolder}
              onOpenDocument={openDocument}
            />
          ) : null}
          <DocumentList
            listState={listState}
            loadError={documentsQuery.error}
            visible={tieredVisible}
            activeFolder={activeFolder}
            total={folderTotal}
            truncated={truncated}
            filtering={filtering}
            search={search}
            setSearch={setSearch}
            deferredSearch={deferredSearch}
            filters={effectiveFilters}
            semesterKnown={semesterKnown}
            setFilters={setFilters}
            uploaders={uploaders}
            kinds={kinds}
            sort={sort}
            setSort={setSort}
            onClearFilters={() => {
              setSearch("");
              setFilters(NO_DOCUMENT_FILTERS);
            }}
            onRetry={() => void documentsQuery.refetch()}
            gate={gate}
            deletingIds={deletingIds}
            onOpen={openDocument}
            onDelete={(doc) => void handleDelete(doc)}
            onShowAllFiles={() => setActiveFolder(null)}
            onUpload={canUpload ? () => upload.openPanel() : undefined}
            marks={marks}
            onHoldRow={hold}
          />
        </div>
      </div>
      {/*
        Rendered last and unconditionally, for the reason `DocumentList`'s states
        no longer are: an offline or error branch that sits over this would
        unmount a pending confirmation without settling its promise, leaving
        `await confirm(...)` hanging forever. That is the two-change
        interaction the Chapter Ops slice shipped and its guard caught.
      */}
      <FolderDialog gate={gate} management={folderManagement} />
      <Suspense fallback={null}>
        <OpenLinkedDocument
          known={documents}
          shown={visibleDocs}
          onReveal={() => {
            // The viewer reads the list as shown, so show all of it.
            setActiveFolder(null);
            setFilters(NO_DOCUMENT_FILTERS);
            setSearch("");
          }}
          onOpen={(id) => {
            viewerOpener.current = null;
            setOpenId(id);
          }}
        />
      </Suspense>
      <DocumentViewer
        documents={visibleDocs}
        openId={openId}
        onOpenChange={setOpenId}
        openerRef={viewerOpener}
      />

      {confirmDialog}
    </div>
  );
}

/**
 * `/documents?document=<id>`: opens that file in the viewer, which is how a
 * source cited by Ask opens (`ask-source-link.ts`). It waits for the library
 * to hold the file, clears a folder, filter or search that hides it (the
 * viewer closes on a file the list does not show), opens it once the list
 * shows it, and takes the parameter back out of the
 * address so closing the viewer and following the same link again works. A
 * file the member cannot see, or one since deleted, opens nothing and leaves
 * them on the library. Its own component because `useSearchParams` needs a
 * Suspense boundary.
 */
function OpenLinkedDocument({
  known,
  shown,
  onReveal,
  onOpen,
}: {
  known: readonly ChapterDocument[];
  shown: readonly ChapterDocument[];
  onReveal: () => void;
  onOpen: (id: string) => void;
}) {
  const linked = useSearchParams()?.get(DOCUMENT_LINK_PARAM) ?? null;
  const found = linked !== null && known.some((doc) => doc.id === linked);
  const visible = found && shown.some((doc) => doc.id === linked);
  // The latest callbacks without making the effect depend on their identity.
  const callbacks = useRef({ onReveal, onOpen });
  useEffect(() => {
    callbacks.current = { onReveal, onOpen };
  });
  useEffect(() => {
    if (!linked || !found) return;
    if (!visible) {
      callbacks.current.onReveal();
      return;
    }
    callbacks.current.onOpen(linked);
    // Next keeps `useSearchParams` in step with the History API, so this
    // clears the parameter without a navigation.
    window.history.replaceState(null, "", window.location.pathname);
  }, [linked, found, visible]);
  return null;
}
