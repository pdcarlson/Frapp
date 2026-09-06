"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  FolderPlus,
  Loader2,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import {
  useConfirmDocumentUpload,
  useCreateDocumentFolder,
  useDeleteDocument,
  useDeleteDocumentFolder,
  selectDownloadUrl,
  useDocument,
  useDocumentFolders,
  useDocuments,
  useRequestDocumentUploadUrl,
  useUpdateDocumentFolder,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
  NestedOffline,
} from "@/components/shared/nested-states";
import { Can } from "@/components/shared/can";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  DocumentsGlyph,
  FolderGlyph,
  SearchGlyph,
} from "@/components/documents/resources-glyphs";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";
import {
  MAX_UPLOAD_LABEL,
  acceptAttribute,
  inspectUploadFile,
} from "@repo/validation";

type ChapterDocument = {
  id: string;
  chapter_id: string;
  title: string;
  description: string | null;
  folder: string | null;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
  content_type: string | null;
  byte_size: number | null;
  document_type: string | null;
  effective_date: string | null;
};

type ChapterDocumentFolder = {
  id: string;
  name: string;
  sort_order: number | null;
};

/**
 * A row in the folder rail. `id` is `null` for a name recovered from the
 * documents themselves when the folder endpoint is unreachable — those rows
 * filter but cannot be managed, because there is no record to address.
 */
type FolderRow = {
  id: string | null;
  name: string;
  sort_order: number | null;
};

// The signed-URL flow blocks SVG + executables. Kind `document` in
// `@repo/validation` is shared with Backwork and chat so the three cannot
// drift (the Backwork page previously omitted gif from a private copy).
function uploadRejectionDescription(reason: "type" | "size"): string {
  if (reason === "size") {
    return `Chapter documents accept files up to ${MAX_UPLOAD_LABEL}.`;
  }
  return "Chapter documents accept PDFs, Office files, text, CSV, and common images (no SVG).";
}

// Deliberately ungated: the signed link comes from `GET /v1/documents/:id`, and
// `enforceSubscription` returns early for GET — a lapsed chapter can still read
// everything it owns (§5 "writes only").
function DownloadButton({ id }: { id: string }) {
  const { toast } = useToast();
  const query = useDocument(id);
  const [isFetching, setIsFetching] = useState(false);

  async function handleDownload() {
    setIsFetching(true);
    try {
      const result = await query.refetch();
      const url = selectDownloadUrl(result.data);
      if (!url) throw new Error("No download URL returned.");
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast({
        title: "Couldn't fetch download link",
        description: getErrorMessage(
          error,
          "Retry in a moment. Signed links are time-limited.",
        ),
        variant: "destructive",
      });
    } finally {
      setIsFetching(false);
    }
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleDownload}
      disabled={isFetching}
    >
      {isFetching ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      Download
    </Button>
  );
}

/**
 * The folder rail's row recipe, written once.
 *
 * Three buttons render it — "All files", "No folder", and each named folder —
 * and it was spelled out three times, so the `pointer-coarse` touch-target fix
 * needed three synchronised edits and nothing would have caught a fourth row
 * drifting.
 *
 * §2's two row states rather than §7's sidebar item: §7 defines one active
 * fill and a hover that falls back to the card, which a rail already sitting
 * *on* a card cannot use. Hover takes `accent-3`, active `accent-4` plus
 * `accent-11` text — the table recipe `components/shared/table-contrast.spec.ts`
 * pins. `FOCUS_RING_OFFSET`, not `FOCUS_RING`: these rows carry no border, and
 * `FOCUS_RING`'s indicator is the border swap.
 */
function folderRowClassName(isActive: boolean): string {
  return [
    "flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
    "pointer-coarse:min-h-11",
    FOCUS_RING_OFFSET,
    isActive
      ? "bg-accent-subtle-hover text-accent-text"
      : "text-muted-foreground hover:bg-accent-subtle hover:text-foreground",
  ].join(" ");
}

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
  const requestUpload = useRequestDocumentUploadUrl();
  const confirmUpload = useConfirmDocumentUpload();
  const deleteDoc = useDeleteDocument();
  const createFolder = useCreateDocumentFolder();
  const updateFolder = useUpdateDocumentFolder();
  const deleteFolder = useDeleteDocumentFolder();

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

  const uploadDialog = useGatedDialog(gate);
  const [uploadDraft, setUploadDraft] = useState<{
    title: string;
    description: string;
    folder: string;
    documentType: string;
    effectiveDate: string;
    file: File | null;
  }>({
    title: "",
    description: "",
    folder: "",
    documentType: "",
    effectiveDate: "",
    file: null,
  });
  const [uploading, setUploading] = useState(false);
  /*
    Which rows' deletes are in flight — a set, not a scalar. `useDeleteDocument` is pessimistic —
    the row only disappears once the DELETE round-trips — so without this
    the row's button stays enabled across the whole request. That is a
    second-delete hazard, and it also defeats `confirm-dialog.tsx`'s focus
    guard: Radix restores focus to the opener the instant the dialog closes,
    long before the request settles, so focus landed on a control that then
    unmounted and dropped to `<body>`. Marked disabled before the await, the
    guard sees `[disabled]` and sends focus to `#main-content` instead —
    which is the fallback it exists for.
  */
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  /*
    One dialog serves create and rename — they differ only in whether an `id`
    is carried and in the copy. Gated like the upload dialog: every folder
    write route carries `chapter_docs:manage` and no `@FreeTier`, so they sit
    behind the same subscription gate the rest of this page's writes do.
  */
  const folderDialog = useGatedDialog(gate);
  const [folderDraft, setFolderDraft] = useState<{
    id: string | null;
    name: string;
  }>({ id: null, name: "" });
  const [folderBusy, setFolderBusy] = useState(false);
  /*
    The same guard `deletingIds` provides for document deletes, in the shape a
    single shared flag needs. `setFolderBusy(true)` only disables the controls
    on the *next* commit, so a fast double-click — or a click on delete while a
    reorder is still in flight — passes the state check twice and runs two
    folder writes under one guard. A ref flips synchronously, so the second call
    sees it before React has painted anything.
  */
  const folderWriteInFlight = useRef(false);

  function beginFolderWrite(): boolean {
    if (folderWriteInFlight.current) return false;
    folderWriteInFlight.current = true;
    setFolderBusy(true);
    return true;
  }

  function endFolderWrite() {
    folderWriteInFlight.current = false;
    setFolderBusy(false);
  }

  function openFolderDialog(folder: FolderRow | null) {
    setFolderDraft({ id: folder?.id ?? null, name: folder?.name ?? "" });
    folderDialog.setOpen(true);
  }

  async function handleSaveFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderDraft.name.trim();
    if (!name) {
      toast({
        title: "Name the folder first",
        description: "A folder name cannot be empty.",
        variant: "destructive",
      });
      return;
    }
    const renaming = folderDraft.id !== null;
    const previousName = renaming
      ? (folders.find((folder) => folder.id === folderDraft.id)?.name ?? null)
      : null;
    if (!beginFolderWrite()) return;
    try {
      if (renaming) {
        await updateFolder.mutateAsync({ id: folderDraft.id!, name });
      } else {
        await createFolder.mutateAsync({ name });
      }
      toast({
        title: renaming ? "Folder renamed" : "Folder created",
        description: renaming
          ? `Documents in this folder now read "${name}".`
          : `"${name}" is ready to file documents into.`,
      });
      // A rename re-files documents server-side, so a tab still pointing at the
      // old name would filter to nothing. Follow the folder rather than reset.
      if (renaming && activeFolder === previousName) setActiveFolder(name);
      folderDialog.setOpen(false);
      setFolderDraft({ id: null, name: "" });
    } catch (error) {
      // The API answers a duplicate name with 409 and a readable body
      // (`A folder named "X" already exists`), which `getErrorMessage` surfaces
      // verbatim — the fallback is for the network-failure case only.
      toast({
        title: renaming ? "Couldn't rename folder" : "Couldn't create folder",
        description: getErrorMessage(
          error,
          "Requires chapter_docs:manage. Retry or confirm your permissions.",
        ),
        variant: "destructive",
      });
    } finally {
      endFolderWrite();
    }
  }

  async function handleDeleteFolder(folder: FolderRow) {
    // Unreachable from the UI — the controls only render for a row that has a
    // record — but it is what makes the nullable id honest rather than asserted.
    if (!folder.id) return;
    const confirmed = await confirm({
      title: `Delete ${folder.name}?`,
      description:
        "The folder is removed. Documents filed in it are kept and move to the root level.",
      confirmLabel: "Delete folder",
      tone: "destructive",
    });
    if (!confirmed) return;
    if (!beginFolderWrite()) return;
    try {
      await deleteFolder.mutateAsync(folder.id);
      toast({
        title: "Folder deleted",
        description: `Documents from ${folder.name} are now under "No folder".`,
      });
      // The server moved the documents; a tab pointing at the deleted name
      // would filter to nothing, so fall back to the unfiltered view.
      if (activeFolder === folder.name) setActiveFolder(null);
    } catch (error) {
      toast({
        title: "Couldn't delete folder",
        description: getErrorMessage(
          error,
          "Requires chapter_docs:manage. Retry or confirm your permissions.",
        ),
        variant: "destructive",
      });
    } finally {
      endFolderWrite();
    }
  }

  /*
    Reorder by rewriting `sort_order` to the target array index rather than
    swapping the two neighbours' existing values.

    Swapping looks cheaper but is not safe here: nothing constrains `sort_order`
    to be distinct, and folders registered implicitly by an upload all land on
    whatever `nextSortOrder` returned at the time. Two folders sharing a value
    make a swap a no-op, so the row would never move. Writing indices converges
    the list to 0..n-1 on first use and is idempotent afterwards — and the
    `sort_order === index` guard keeps the common case at exactly two PATCHes.
  */
  async function handleMoveFolder(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= folders.length) return;
    const moved = folders[index];
    if (!moved) return;
    const reordered = [...folders];
    reordered.splice(index, 1);
    reordered.splice(target, 0, moved);

    const changed = reordered
      .map((folder, position) => ({ folder, position }))
      .filter(({ folder, position }) => folder.sort_order !== position);
    if (changed.length === 0) return;

    if (!beginFolderWrite()) return;
    /*
      Applied one PATCH at a time, and `applied` counts how far it got. There is
      no transaction across these rows, so a failure partway leaves some folders
      moved — reporting a flat "nothing happened" would be a false claim about
      the list the member is looking at. Say which it is, and refetch so the rail
      shows the order that actually persisted rather than the one we attempted.
    */
    let applied = 0;
    try {
      for (const { folder, position } of changed) {
        if (!folder.id) continue;
        await updateFolder.mutateAsync({ id: folder.id, sort_order: position });
        applied += 1;
      }
    } catch (error) {
      toast({
        title: "Couldn't reorder folders",
        description:
          applied > 0
            ? "Some folders moved before this failed — the list below shows the order that saved."
            : getErrorMessage(
                error,
                "Requires chapter_docs:manage. Retry or confirm your permissions.",
              ),
        variant: "destructive",
      });
      void foldersQuery.refetch();
    } finally {
      endFolderWrite();
    }
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = uploadDraft.file;
    if (!file) {
      toast({
        title: "Choose a file first",
        description: "Drag in a file or click Browse to attach one.",
        variant: "destructive",
      });
      return;
    }
    const inspected = inspectUploadFile("document", file);
    if (!inspected.ok) {
      toast({
        title:
          inspected.reason === "size"
            ? "File too large"
            : "File type not allowed",
        description: uploadRejectionDescription(inspected.reason),
        variant: "destructive",
      });
      return;
    }
    const contentType = inspected.contentType;
    setUploading(true);
    try {
      const signed = await requestUpload.mutateAsync({
        filename: file.name,
        content_type: contentType,
      });
      const signedUrl =
        signed && typeof signed === "object" && "upload_url" in signed
          ? (signed as { upload_url?: string }).upload_url
          : null;
      const storagePath =
        signed && typeof signed === "object" && "storage_path" in signed
          ? (signed as { storage_path?: string }).storage_path
          : null;
      if (!signedUrl || !storagePath) {
        throw new Error(
          "Upload URL response missing signed URL or storage path.",
        );
      }

      const response = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: {
          "content-type": contentType,
          "x-upsert": "true",
        },
      });
      if (!response.ok) {
        throw new Error(
          `Storage rejected upload (${response.status}). Retry or check file size.`,
        );
      }

      await confirmUpload.mutateAsync({
        storage_path: storagePath,
        title: uploadDraft.title.trim() || file.name,
        description: uploadDraft.description.trim() || undefined,
        folder: uploadDraft.folder.trim() || undefined,
        content_type: contentType,
        byte_size: file.size,
        document_type: uploadDraft.documentType.trim() || undefined,
        effective_date: uploadDraft.effectiveDate || undefined,
      });
      toast({
        title: "Document uploaded",
        description: `${file.name} is now in the chapter library.`,
      });
      uploadDialog.setOpen(false);
      setUploadDraft({
        title: "",
        description: "",
        folder: "",
        documentType: "",
        effectiveDate: "",
        file: null,
      });
    } catch (error) {
      toast({
        title: "Couldn't upload document",
        description: getErrorMessage(
          error,
          "Retry the upload. Signed URLs expire quickly.",
        ),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

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
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Chapter documents
          </h2>
          <p className="text-sm text-muted-foreground">
            Organizational files — bylaws, constitutions, meeting agendas. Every
            chapter member can download; upload and delete are permission-gated.
          </p>
        </div>
        <Can permission="chapter_docs:upload">
          <Dialog {...uploadDialog.dialogProps}>
            <DialogTrigger asChild>
              <Button className="gap-2" {...gate.controlProps()}>
                <Upload className="h-4 w-4" /> Upload document
              </Button>
            </DialogTrigger>
            <DialogContent
              className="sm:max-w-lg"
              {...uploadDialog.contentProps}
            >
              <DialogHeader>
                <DialogTitle>Upload a chapter document</DialogTitle>
                <DialogDescription>
                  Max {MAX_UPLOAD_LABEL}. PDFs, Word/Excel/PowerPoint, text/CSV,
                  and images are allowed — no SVGs or executables.
                </DialogDescription>
              </DialogHeader>
              <form
                id="doc-upload-form"
                onSubmit={handleUpload}
                className="space-y-4"
              >
                <div className="grid gap-1">
                  <Label htmlFor="doc-title">Title</Label>
                  <Input
                    id="doc-title"
                    value={uploadDraft.title}
                    onChange={(event) =>
                      setUploadDraft((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Fall 2026 bylaws revision"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="doc-description">
                    Description (optional)
                  </Label>
                  <Textarea
                    id="doc-description"
                    rows={2}
                    value={uploadDraft.description}
                    onChange={(event) =>
                      setUploadDraft((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="doc-folder">Folder (optional)</Label>
                  <Input
                    id="doc-folder"
                    value={uploadDraft.folder}
                    onChange={(event) =>
                      setUploadDraft((prev) => ({
                        ...prev,
                        folder: event.target.value,
                      }))
                    }
                    placeholder="Governance"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="doc-type">Document type (optional)</Label>
                  <Input
                    id="doc-type"
                    value={uploadDraft.documentType}
                    onChange={(event) =>
                      setUploadDraft((prev) => ({
                        ...prev,
                        documentType: event.target.value,
                      }))
                    }
                    placeholder="Bylaws"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="doc-effective-date">
                    Effective date (optional)
                  </Label>
                  <Input
                    id="doc-effective-date"
                    type="date"
                    value={uploadDraft.effectiveDate}
                    onChange={(event) =>
                      setUploadDraft((prev) => ({
                        ...prev,
                        effectiveDate: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="doc-file">File</Label>
                  <Input
                    id="doc-file"
                    type="file"
                    accept={acceptAttribute("document")}
                    onChange={(event) =>
                      setUploadDraft((prev) => ({
                        ...prev,
                        file: event.target.files?.[0] ?? null,
                      }))
                    }
                  />
                </div>
              </form>
              <DialogFooter>
                {/* Cancel only closes the dialog — gating the way out of a
                    surface the gate just blocked would be a trap. */}
                <Button
                  variant="secondary"
                  onClick={() => uploadDialog.setOpen(false)}
                  disabled={uploading}
                >
                  Cancel
                </Button>
                <Button
                  form="doc-upload-form"
                  type="submit"
                  {...gate.controlProps(uploading || !uploadDraft.file)}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Upload
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Can>
      </header>

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

      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm">Folders</CardTitle>
                <CardDescription>
                  Flat, one-level deep. Naming a new folder during upload still
                  registers it.
                </CardDescription>
              </div>
              <Can permission="chapter_docs:manage">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="New folder"
                  onClick={() => openFolderDialog(null)}
                  {...gate.controlProps(folderBusy)}
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </Can>
            </div>
          </CardHeader>
          {/*
            The two filter rows stay ungated — they are client-side filters over
            the loaded list, not writes. The per-folder management controls
            beside each named row are gated, because those *are* the folder
            write routes (`chapter_docs:manage`, no `@FreeTier`).
          */}
          <CardContent className="space-y-1 p-2">
            <button
              type="button"
              onClick={() => setActiveFolder(null)}
              className={folderRowClassName(activeFolder === null)}
            >
              <FolderGlyph className="h-4 w-4" active={activeFolder === null} />{" "}
              All files
            </button>
            <button
              type="button"
              onClick={() => setActiveFolder("")}
              className={folderRowClassName(activeFolder === "")}
            >
              <DocumentsGlyph
                className="h-4 w-4"
                active={activeFolder === ""}
              />{" "}
              No folder
            </button>
            {railFolders.map((folder, index) => (
              <div key={folder.id ?? `derived:${folder.name}`}>
                <button
                  type="button"
                  onClick={() => setActiveFolder(folder.name)}
                  className={folderRowClassName(activeFolder === folder.name)}
                >
                  <FolderGlyph
                    className="h-4 w-4 shrink-0"
                    active={activeFolder === folder.name}
                  />
                  <span className="truncate">{folder.name}</span>
                </button>
                {/*
                  `id === null` means this name was recovered from the documents
                  because the folder endpoint is down — there is no record to
                  rename, reorder or delete, so the row filters and nothing more.
                */}
                {folder.id ? (
                  <Can permission="chapter_docs:manage">
                    {/*
                      A second line under the name rather than a trailing cluster
                      on the same row: at the rail's 240px these four controls
                      cannot sit beside a folder name and still clear §2's
                      44px touch floor, and shrinking them below it is what
                      `button.tsx`'s `icon` size exists to prevent. Four controls
                      also do not earn a popover, and hiding them behind one
                      gated trigger would lose the per-control disabled
                      explanation §5 rule 4 asks for.
                    */}
                    <div className="flex items-center justify-end gap-0.5 pb-1 pl-6">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11"
                        aria-label={`Move ${folder.name} up`}
                        onClick={() => void handleMoveFolder(index, -1)}
                        {...gate.controlProps(folderBusy || index === 0)}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11"
                        aria-label={`Move ${folder.name} down`}
                        onClick={() => void handleMoveFolder(index, 1)}
                        {...gate.controlProps(
                          folderBusy || index === railFolders.length - 1,
                        )}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11"
                        aria-label={`Rename ${folder.name}`}
                        onClick={() => openFolderDialog(folder)}
                        {...gate.controlProps(folderBusy)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11"
                        aria-label={`Delete folder ${folder.name}`}
                        onClick={() => void handleDeleteFolder(folder)}
                        {...gate.controlProps(folderBusy)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </Can>
                ) : null}
              </div>
            ))}
            {/*
              Said once, under the rail, rather than replacing it: the names
              above are the pre-#791 derived fallback and still filter correctly,
              so the honest report is that management is unavailable — not that
              the chapter has no folders.
            */}
            {foldersQuery.isError ? (
              <p className="px-2 pt-2 text-xs text-muted-foreground">
                {deferredSearch
                  ? "Couldn't load the folder list, so folder filters are unavailable while searching. Clear the search to get them back."
                  : "Couldn't load the folder list, so these are read from the documents shown. Empty folders and folder management are unavailable until it loads."}{" "}
                <button
                  type="button"
                  className={`underline ${FOCUS_RING_OFFSET}`}
                  onClick={() => void foldersQuery.refetch()}
                >
                  Retry
                </button>
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              {activeFolder === null
                ? "All documents"
                : activeFolder === ""
                  ? "Uncategorized documents"
                  : activeFolder}
            </CardTitle>
            {/*
              Rendered only once there is a count to state. A placeholder
              character here would put a stray non-breaking space in the
              accessibility tree, and "0 documents." while the query is still
              in flight is a claim about the library rather than a description
              of it — the state below already says what is happening.
            */}
            {listState === "ready" ? (
              <CardDescription>
                {visible.length} document{visible.length === 1 ? "" : "s"}
                {deferredSearch ? ` matching "${deferredSearch}"` : ""}.
              </CardDescription>
            ) : null}
            {/*
              `type="search"`, not `type="text"`: it gets the browser's own
              clear affordance and the correct role, so no hand-rolled X button
              is owed. The visible <Label> is `sr-only` rather than absent — a
              placeholder is not an accessible name.

              Icon placement follows the dashboard's existing search inputs
              (`events-page.tsx`, `alumni-directory.tsx`): the shared glyph at a
              fixed `top-2.5` against an `h-11` field. The wrapper carries the
              spacing so the icon offset never has to compensate for it.
            */}
            <div className="pt-2">
              <div className="relative">
                <Label htmlFor="doc-search" className="sr-only">
                  Search documents
                </Label>
                <SearchGlyph className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="doc-search"
                  type="search"
                  className="h-11 pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by title"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/*
              The nested variants, not the whole-screen ones: these render
              inside a `<CardContent>`, where a `bg-card` state on a `bg-card`
              card composites to exactly 1.00:1 and the region disappears
              (`components.md` §10).
            */}
            {listState === "offline-search" ? (
              <NestedOffline
                sole
                title="Search needs a connection"
                description="Clear the search to browse the documents already on this device."
              />
            ) : listState === "offline" ? (
              <NestedOffline
                sole
                title="Documents unavailable offline"
                description="Reconnect to browse the chapter library and download files."
                onRetry={() => {
                  void documentsQuery.refetch();
                }}
              />
            ) : listState === "loading" ? (
              <NestedLoading message="Loading chapter documents..." sole />
            ) : listState === "error" ? (
              <NestedError
                sole
                title="Couldn't load documents"
                description="Confirm your chapter access and retry."
                onRetry={() => void documentsQuery.refetch()}
              />
            ) : listState === "empty" ? (
              /*
                A search that matched nothing is not an empty library, and
                offering "upload some files" to a member who mistyped a title
                answers a question they did not ask.
              */
              deferredSearch ? (
                <NestedEmpty
                  sole
                  title="No documents match that search"
                  description={
                    activeFolder === null
                      ? `Nothing in the chapter library has "${deferredSearch}" in its title.`
                      : `No match in this folder. Try "All files" to search the whole library.`
                  }
                />
              ) : (
                <NestedEmpty
                  sole
                  title="No documents here yet"
                  description="Upload chapter files like bylaws, agendas, and meeting minutes so everyone can find them."
                />
              )
            ) : (
              /*
                `divide-border/70` dilutes `--border` to 1.169:1 on a card
                against the token's 1.253:1, and neither clears the 3:1
                non-text floor — `components.md` §2: "a hairline's alpha is
                not a free parameter". Chapter Ops found five of these; this
                is the sixth.
              */
              <ul className="divide-y divide-border">
                {visible.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3"
                  >
                    {/*
                      s12 draws a leading file glyph on every document row —
                      the accent duotone on its pinned cards, the neutral one
                      on the recent list. Web has no pin field, so every row
                      takes the neutral variant.
                    */}
                    <DocumentsGlyph className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {doc.title}
                      </p>
                      {doc.description ? (
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {doc.description}
                        </p>
                      ) : null}
                      <p className="text-[12.5px] text-muted-foreground">
                        Uploaded {new Date(doc.created_at).toLocaleDateString()}
                        {doc.folder ? ` · ${doc.folder}` : ""}
                        {doc.document_type ? ` · ${doc.document_type}` : ""}
                        {doc.effective_date
                          ? ` · Effective ${new Date(doc.effective_date).toLocaleDateString()}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 sm:ml-auto">
                      <DownloadButton id={doc.id} />
                      <Can permission="chapter_docs:manage">
                        {/*
                          `DELETE /v1/documents/:id` sits behind the same guard
                          as upload, so gating only the upload trigger would
                          have the page claim writes are blocked while still
                          offering one per row.
                        */}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${doc.title}`}
                          onClick={() => void handleDelete(doc)}
                          {...gate.controlProps(deletingIds.has(doc.id))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Can>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {/*
        Rendered last and unconditionally, for the reason the states above no
        longer are: an offline or error branch that sits over this would
        unmount a pending confirmation without settling its promise, leaving
        `await confirm(...)` hanging forever. That is the two-change
        interaction the Chapter Ops slice shipped and its guard caught.
      */}
      {/*
        Controlled with no `DialogTrigger` — it is opened from any of the
        per-folder rename buttons or the header's New folder button, so there is
        no single trigger element to wrap.
      */}
      <Dialog {...folderDialog.dialogProps}>
        <DialogContent className="sm:max-w-md" {...folderDialog.contentProps}>
          <DialogHeader>
            <DialogTitle>
              {folderDraft.id ? "Rename folder" : "New folder"}
            </DialogTitle>
            <DialogDescription>
              {folderDraft.id
                ? "Documents record their folder by name, so renaming re-files every document in it."
                : "Folders are flat and one level deep. Create it now, then file documents into it on upload."}
            </DialogDescription>
          </DialogHeader>
          <form
            id="doc-folder-form"
            onSubmit={handleSaveFolder}
            className="space-y-4"
          >
            <div className="grid gap-1">
              <Label htmlFor="doc-folder-name">Folder name</Label>
              <Input
                id="doc-folder-name"
                value={folderDraft.name}
                onChange={(event) =>
                  setFolderDraft((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="Governance"
              />
            </div>
          </form>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => folderDialog.setOpen(false)}
              disabled={folderBusy}
            >
              Cancel
            </Button>
            <Button
              form="doc-folder-form"
              type="submit"
              {...gate.controlProps(folderBusy || !folderDraft.name.trim())}
            >
              {folderBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {folderDraft.id ? "Rename folder" : "Create folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
