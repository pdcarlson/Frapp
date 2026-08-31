"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Trash2, Upload } from "lucide-react";
import {
  useConfirmDocumentUpload,
  useDeleteDocument,
  selectDownloadUrl,
  useDocument,
  useDocuments,
  useRequestDocumentUploadUrl,
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
 * `accent-11` text — the table recipe `components/shared/table-contrast.test.ts`
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
  const documentsQuery = useDocuments();
  const requestUpload = useRequestDocumentUploadUrl();
  const confirmUpload = useConfirmDocumentUpload();
  const deleteDoc = useDeleteDocument();

  const documents = useMemo(
    () => asArray<ChapterDocument>(documentsQuery.data),
    [documentsQuery.data],
  );

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const doc of documents) {
      if (doc.folder) set.add(doc.folder);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [documents]);

  const [activeFolder, setActiveFolder] = useState<string | null>(null);

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
        nothing to disable. `can-fallback.test.tsx` derives this rather than
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
            <CardTitle className="text-sm">Folders</CardTitle>
            <CardDescription>
              Flat, one-level deep. Admins can create a folder by typing its
              name during upload.
            </CardDescription>
          </CardHeader>
          {/*
            Ungated on purpose: these are client-side filters over the already
            loaded list, not folder writes — the API's folder create/rename/
            delete routes have no control on this page, and the one way to make
            a folder here is the gated upload dialog's Folder field.
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
            {folders.map((folder) => (
              <button
                key={folder}
                type="button"
                onClick={() => setActiveFolder(folder)}
                className={folderRowClassName(activeFolder === folder)}
              >
                <FolderGlyph
                  className="h-4 w-4"
                  active={activeFolder === folder}
                />{" "}
                {folder}
              </button>
            ))}
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
                {visible.length} document{visible.length === 1 ? "" : "s"}.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            {/*
              The nested variants, not the whole-screen ones: these render
              inside a `<CardContent>`, where a `bg-card` state on a `bg-card`
              card composites to exactly 1.00:1 and the region disappears
              (`components.md` §10).
            */}
            {listState === "offline" ? (
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
              <NestedEmpty
                sole
                title="No documents here yet"
                description="Upload chapter files like bylaws, agendas, and meeting minutes so everyone can find them."
              />
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
      {confirmDialog}
    </div>
  );
}
