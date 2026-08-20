"use client";

import { useMemo, useState } from "react";
import { Download, FileText, FolderOpen, Loader2, Trash2, Upload } from "lucide-react";
import {
  useConfirmDocumentUpload,
  useDeleteDocument,
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
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
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
      const url =
        result.data && typeof result.data === "object" && "download_url" in result.data
          ? (result.data as { download_url?: string }).download_url
          : null;
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
      variant="outline"
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

export function DocumentsPage() {
  const { toast } = useToast();
  // Every write route on `ChapterDocumentController` (upload URL, confirm,
  // delete) carries no `@FreeTier`, so they are all paid-ops behind the same
  // subscription guard — one gate covers the surface (#841).
  const gate = useSubscriptionGate();
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
            activeFolder === ""
              ? !doc.folder
              : doc.folder === activeFolder,
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
    file: File | null;
  }>({ title: "", description: "", folder: "", file: null });
  const [uploading, setUploading] = useState(false);

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
        throw new Error("Upload URL response missing signed URL or storage path.");
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
      });
      toast({
        title: "Document uploaded",
        description: `${file.name} is now in the chapter library.`,
      });
      uploadDialog.setOpen(false);
      setUploadDraft({ title: "", description: "", folder: "", file: null });
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
    const confirmed = window.confirm(
      `Delete ${doc.title}? This removes the file from chapter storage immediately.`,
    );
    if (!confirmed) return;
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
    }
  }

  if (documentsQuery.isPending) {
    return <LoadingState message="Loading chapter documents..." />;
  }

  if (documentsQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load documents"
        description="Confirm your chapter access and retry."
        onRetry={() => void documentsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Chapter documents</h2>
          <p className="text-sm text-muted-foreground">
            Organizational files — bylaws, constitutions, meeting agendas.
            Every chapter member can download; upload and delete are
            permission-gated.
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
                  Max {MAX_UPLOAD_LABEL}. PDFs, Word/Excel/PowerPoint, text/CSV, and images
                  are allowed — no SVGs or executables.
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
                  <Label htmlFor="doc-description">Description (optional)</Label>
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
                  variant="outline"
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
      <Can anyOf={["chapter_docs:upload", "chapter_docs:manage"]}>
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
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                activeFolder === null
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted"
              }`}
            >
              <FolderOpen className="h-4 w-4" /> All files
            </button>
            <button
              type="button"
              onClick={() => setActiveFolder("")}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                activeFolder === ""
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted"
              }`}
            >
              <FileText className="h-4 w-4" /> No folder
            </button>
            {folders.map((folder) => (
              <button
                key={folder}
                type="button"
                onClick={() => setActiveFolder(folder)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                  activeFolder === folder
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                }`}
              >
                <FolderOpen className="h-4 w-4" /> {folder}
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
            <CardDescription>
              {visible.length} document{visible.length === 1 ? "" : "s"}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {visible.length === 0 ? (
              <EmptyState
                title="No documents here yet"
                description="Upload chapter files like bylaws, agendas, and meeting minutes so everyone can find them."
              />
            ) : (
              <ul className="divide-y divide-border/70">
                {visible.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                      {doc.description ? (
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {doc.description}
                        </p>
                      ) : null}
                      <p className="text-[11px] text-muted-foreground">
                        Uploaded {new Date(doc.created_at).toLocaleDateString()}
                        {doc.folder ? ` · ${doc.folder}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
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
                          {...gate.controlProps()}
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
    </div>
  );
}
