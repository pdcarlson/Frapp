"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  useDeleteDocument,
  useDocumentFolders,
  useDocuments,
} from "@repo/hooks";
import { Can } from "@/components/shared/can";
import { PageHeader } from "@/components/layout/page-header";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { DocumentList } from "@/components/documents/document-list";
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
  UploadDocumentDialog,
  useDocumentUpload,
} from "@/components/documents/upload-document-dialog";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/lib/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

export function DocumentsPage() {
  const { toast } = useToast();
  // Every write route on `ChapterDocumentController` (upload URL, confirm,
  // delete) carries no `@FreeTier`, so they are all paid-ops behind the same
  // subscription guard — one gate covers the surface (#841).
  const gate = useSubscriptionGate();
  const { isOffline } = useNetwork();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [search, setSearch] = useState("");
  /*
    Deferred rather than fed raw, for the reason mobile's s12 screen documents:
    `search` is part of `useDocuments`' query key, so a keystroke-per-request
    would mint a cache entry per character and blank the list to a skeleton on
    each one. The trim happens before the defer so " " and "" are the same key.

    `%` and `_` need no escaping here — `spec/behavior/chapter-docs.md` § Search
    pins that the server matches them literally.
  */
  const deferredSearch = useDeferredValue(search.trim());
  const documentsQuery = useDocuments({
    search: deferredSearch || undefined,
  });
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

    The derivation only runs against an *unfiltered* list. `documents` is the
    search response, so deriving from it mid-search would rebuild the rail out
    of the matches alone and drop every folder containing nothing that matched —
    tabs vanishing key by key as someone types, including the selected one. So
    while a search is active and the endpoint is down, the rail keeps only its
    two built-in filters and the notice below says so. Remembering the last
    unfiltered list instead would mean a ref written during render or a
    setState in an effect, both of which the compiler rejects and neither of
    which is worth it to prop up a degraded path.
  */
  const railFolders = useMemo<FolderRow[]>(() => {
    if (!foldersQuery.isError) return folders;
    if (deferredSearch) return [];
    const names = new Set<string>();
    for (const doc of documents) {
      if (doc.folder) names.add(doc.folder);
    }
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ id: null, name, sort_order: null }));
  }, [folders, foldersQuery.isError, deferredSearch, documents]);

  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  /*
    Folder filtering stays client-side while search goes to the server. The
    two compose: the server narrows to title matches across the whole chapter,
    and the tab then narrows that to one folder. Keeping the tab local means
    switching folders is instant rather than a refetch per tab, which is the
    behaviour this page already had and its tests already pin.
  */
  const visible = useMemo(() => {
    const filtered =
      activeFolder === null
        ? documents
        : documents.filter((doc) =>
            activeFolder === "" ? !doc.folder : doc.folder === activeFolder,
          );
    return filtered.sort((a, b) =>
      (a.title || "").localeCompare(b.title || ""),
    );
  }, [activeFolder, documents]);

  const upload = useDocumentUpload(gate);
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
        description: getErrorMessage(
          error,
          "Requires chapter_docs:manage. Retry or confirm your permissions.",
        ),
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
    Being offline *with* content is the shell's `OfflineBanner`'s job; it
    renders on every route already, so the screen owes a state only when it
    has nothing else to say. Gated on `documents`, not `visible`: a folder
    filter that matches nothing is the empty case, not the offline one.
  */
  /*
    `offline-search` is its own state, and it exists because server-side search
    reintroduced the hazard the comment above rules out. Each query string is a
    distinct cache key, so an offline member who types one lands on a key that
    was never fetched — `documents` goes empty and the plain offline branch
    would replace a library they had cached moments earlier. Naming the state
    keeps the recovery honest: the search is what needs a connection, and
    clearing it brings their documents straight back.
  */
  const listState =
    isOffline && documents.length === 0 && deferredSearch
      ? "offline-search"
      : isOffline && documents.length === 0
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
      <PageHeader
        title="Chapter Documents"
        actions={
          <Can permission="chapter_docs:upload">
            <UploadDocumentDialog gate={gate} upload={upload} />
          </Can>
        }
      />
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
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-[200px_minmax(0,1fr)]">
        <FolderRail
          railFolders={railFolders}
          activeFolder={activeFolder}
          setActiveFolder={setActiveFolder}
          gate={gate}
          management={folderManagement}
          loadFailed={foldersQuery.isError}
          searching={!!deferredSearch}
          onRetryLoad={() => void foldersQuery.refetch()}
        />

        <DocumentList
          listState={listState}
          visible={visible}
          activeFolder={activeFolder}
          search={search}
          setSearch={setSearch}
          deferredSearch={deferredSearch}
          onRetry={() => void documentsQuery.refetch()}
          gate={gate}
          deletingIds={deletingIds}
          onDelete={(doc) => void handleDelete(doc)}
        />
      </div>
      {/*
        Rendered last and unconditionally, for the reason the states above no
        longer are: an offline or error branch that sits over this would
        unmount a pending confirmation without settling its promise, leaving
        `await confirm(...)` hanging forever. That is the two-change
        interaction the Chapter Ops slice shipped and its guard caught.
      */}
      <FolderDialog gate={gate} management={folderManagement} />

      {confirmDialog}
    </div>
  );
}
