"use client";

import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import {
  putSignedUpload,
  useConfirmDocumentUpload,
  useRequestDocumentUploadUrl,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
  UPLOAD_FIELD_CLASS,
  UPLOAD_SHEET_BUTTON_CLASS,
  UploadField,
  UploadFileField,
  UploadSheetBody,
  UploadSheetContent,
  UploadSheetFooter,
  UploadSheetTitle,
} from "@/components/shared/upload-sheet";
import {
  useGatedDialog,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import {
  MAX_UPLOAD_LABEL,
  acceptAttribute,
  inspectUploadFile,
  readSignedUpload,
} from "@repo/validation";

/*
  The signed-URL flow blocks SVG + executables. Kind `document` in
  `@repo/validation` is shared with Backwork and chat so the three cannot drift
  (the Backwork page previously omitted gif from a private copy).

  **Each string now names the verdict, because it no longer has a title to do
  that for it.** These were toast *bodies*, under a title reading "File too
  large" or "File type not allowed"; they are now the whole inline error, and a
  standalone "Chapter documents accept files up to 25MB." states a rule without
  ever saying that the member's file broke it.
*/
function uploadRejectionDescription(reason: "type" | "size"): string {
  if (reason === "size") {
    return `That file is too large. Chapter documents accept files up to ${MAX_UPLOAD_LABEL}.`;
  }
  return "That file type is not allowed. Chapter documents accept PDFs, Office files, text, CSV, and common images (no SVG).";
}

type UploadDraft = {
  title: string;
  description: string;
  folder: string;
  documentType: string;
  effectiveDate: string;
  file: File | null;
};

const EMPTY_UPLOAD_DRAFT: UploadDraft = {
  title: "",
  description: "",
  folder: "",
  documentType: "",
  effectiveDate: "",
  file: null,
};

/**
 * The upload sheet's state and submit. The page calls this rather than the
 * sheet, so the draft stays on the page as it always has: the sheet renders
 * inside a `Can`, and state owned by a gated child would go whenever the gate
 * unmounts it.
 */
export function useDocumentUpload(gate: SubscriptionGate) {
  const { toast } = useToast();
  const requestUpload = useRequestDocumentUploadUrl();
  const confirmUpload = useConfirmDocumentUpload();
  const uploadDialog = useGatedDialog(gate);
  const [uploadDraft, setUploadDraft] =
    useState<UploadDraft>(EMPTY_UPLOAD_DRAFT);
  const [uploading, setUploading] = useState(false);
  /*
    The upload sheet's one inline error, held on the page rather than inside
    `UploadFileField` because `handleUpload` is what discovers it: the file is
    inspected on submit, against `@repo/validation`'s shared allowlist, and the
    field cannot know the verdict before then.
  */
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    /*
      Both rejections are now inline on the field they are about, not a toast
      (board `1j`: "errors inline on touched fields"). A toast is the right
      shape for something that happened elsewhere — the network, the storage
      bucket — and the wrong one for "this control's value is wrong", which the
      member has to read *and then act on* while the toast is timing out over
      the top-right corner of a form they are still in.

      The upload failures further down stay toasts for exactly that reason.
    */
    const file = uploadDraft.file;
    if (!file) {
      setUploadError("Choose a file to upload.");
      return;
    }
    const inspected = inspectUploadFile("document", file);
    if (!inspected.ok) {
      setUploadError(uploadRejectionDescription(inspected.reason));
      return;
    }
    setUploadError(null);
    const contentType = inspected.contentType;
    setUploading(true);
    try {
      const signed = await requestUpload.mutateAsync({
        filename: file.name,
        content_type: contentType,
      });
      const { signedUrl, storagePath } = readSignedUpload(signed);

      await putSignedUpload({
        signedUrl,
        body: file,
        contentType,
        upsert: true,
        describeRejection: (status) =>
          `Storage rejected upload (${status}). Retry or check file size.`,
      });

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
      setUploadDraft(EMPTY_UPLOAD_DRAFT);
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

  return {
    uploadDialog,
    uploadDraft,
    setUploadDraft,
    uploading,
    uploadError,
    setUploadError,
    handleUpload,
  };
}

export type DocumentUpload = ReturnType<typeof useDocumentUpload>;

export function UploadDocumentDialog({
  gate,
  upload,
}: {
  gate: SubscriptionGate;
  upload: DocumentUpload;
}) {
  const {
    uploadDialog,
    uploadDraft,
    setUploadDraft,
    uploading,
    uploadError,
    setUploadError,
    handleUpload,
  } = upload;

  /*
    Cleared on OPEN, not on close, and the difference is the whole
    reason this is written down.

    Two of the three ways this dialog closes never reach an
    `onOpenChange` handler at all. Radix `Root` runs the prop through
    `useControllableState`, whose `onChange` fires only when Radix's
    own setter runs — Escape, the scrim, the X. Cancel calls
    `uploadDialog.setOpen(false)` directly, and `useGatedDialog`'s
    revoke effect calls its internal `setOpenState(false)`; both just
    change the controlled prop, and neither notifies anyone. Clearing
    on close therefore left a spent rejection sitting under the file
    field the next time the sheet opened after a Cancel.

    Opening has no such hole: there is no `setOpen(true)` anywhere on
    this page, so every open is a `DialogTrigger` press, which does go
    through Radix's setter. Clearing there is reached by every route
    into a fresh sheet, whatever ended the last one.

    The draft itself survives on purpose: a mistyped title is worth
    keeping, a spent error is not.
  */
  return (
    <Dialog
      {...uploadDialog.dialogProps}
      onOpenChange={(next) => {
        if (next) setUploadError(null);
        uploadDialog.dialogProps.onOpenChange(next);
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2" {...gate.controlProps()}>
          <Upload className="h-4 w-4" /> Upload document
        </Button>
      </DialogTrigger>
      <UploadSheetContent {...uploadDialog.contentProps}>
        <UploadSheetTitle>Upload a chapter document</UploadSheetTitle>
        <UploadSheetBody id="doc-upload-form" onSubmit={handleUpload}>
          {/*
              The file first, where the board puts it: it is the only
              required field on this form, and it is the one the member
              came to supply. It used to sit last, under five optional
              metadata fields.
            */}
          <UploadFileField
            id="doc-file"
            label="File"
            hint={`Up to ${MAX_UPLOAD_LABEL}. PDFs, Office files, text, CSV, and common images. No SVGs or executables.`}
            accept={acceptAttribute("document")}
            file={uploadDraft.file}
            error={uploadError}
            disabled={uploading}
            onSelect={(file) => {
              setUploadError(null);
              setUploadDraft((prev) => ({ ...prev, file }));
            }}
          />
          <UploadField id="doc-title" label="Title">
            <Input
              id="doc-title"
              className={UPLOAD_FIELD_CLASS}
              value={uploadDraft.title}
              onChange={(event) =>
                setUploadDraft((prev) => ({
                  ...prev,
                  title: event.target.value,
                }))
              }
              placeholder="Fall 2026 bylaws revision"
            />
          </UploadField>
          <UploadField id="doc-description" label="Description (optional)">
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
          </UploadField>
          <div className="grid gap-3 sm:grid-cols-2">
            <UploadField id="doc-folder" label="Folder (optional)">
              <Input
                id="doc-folder"
                className={UPLOAD_FIELD_CLASS}
                value={uploadDraft.folder}
                onChange={(event) =>
                  setUploadDraft((prev) => ({
                    ...prev,
                    folder: event.target.value,
                  }))
                }
                placeholder="Governance"
              />
            </UploadField>
            <UploadField id="doc-type" label="Document type (optional)">
              <Input
                id="doc-type"
                className={UPLOAD_FIELD_CLASS}
                value={uploadDraft.documentType}
                onChange={(event) =>
                  setUploadDraft((prev) => ({
                    ...prev,
                    documentType: event.target.value,
                  }))
                }
                placeholder="Bylaws"
              />
            </UploadField>
          </div>
          <UploadField
            id="doc-effective-date"
            label="Effective date (optional)"
          >
            <Input
              id="doc-effective-date"
              type="date"
              className={UPLOAD_FIELD_CLASS}
              value={uploadDraft.effectiveDate}
              onChange={(event) =>
                setUploadDraft((prev) => ({
                  ...prev,
                  effectiveDate: event.target.value,
                }))
              }
            />
          </UploadField>
        </UploadSheetBody>
        <UploadSheetFooter>
          {/* Cancel only closes the dialog. Gating the way out of a
                surface the gate just blocked would be a trap. */}
          <Button
            variant="secondary"
            className={UPLOAD_SHEET_BUTTON_CLASS}
            onClick={() => uploadDialog.setOpen(false)}
            disabled={uploading}
          >
            Cancel
          </Button>
          {/*
              Enabled with no file chosen, which the board asks for by
              name. The old form disabled Upload until a file was
              attached, so a member who missed the field got a control
              that did nothing and said nothing; now the press answers
              them, inline and under the field that is wrong. The
              subscription gate still disables it, because that is a
              verdict about the chapter rather than about this form.
            */}
          <Button
            form="doc-upload-form"
            type="submit"
            className={UPLOAD_SHEET_BUTTON_CLASS}
            {...gate.controlProps(uploading)}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Upload
          </Button>
        </UploadSheetFooter>
      </UploadSheetContent>
    </Dialog>
  );
}
