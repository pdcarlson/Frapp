"use client";

import { useRef } from "react";
import { ChevronDown, FolderSync, FolderUp } from "lucide-react";
import { useGoogleDriveStatus, type DocumentTypeRow } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import {
  UploadDocumentPanel,
  type DocumentUpload,
} from "@/components/documents/upload-document-panel";
import { FolderImportPanel } from "@/components/documents/folder-import-panel";
import type { ImportContext } from "@/lib/documents/folder-import-session";
import { DriveFolderPanel } from "@/components/documents/drive-folder-panel";
import type {
  ChapterDocument,
  FolderRow,
} from "@/components/documents/document-types";

/**
 * Documents' one way in (#5576): an outlined Upload button, and beside it a
 * menu holding the rarer ways, Import a folder and Google Drive, as Google
 * Drive's New and Dropbox's Upload menus hold folder uploads and connected
 * sources. Three buttons in a row used to sit over the library; the page's
 * weight goes to the files now.
 *
 * Each panel keeps its own dialog and draft; the menu only opens it.
 */
export function UploadMenu({
  gate,
  upload,
  folders,
  typeOptions,
  typeRows,
  importContext,
  documents,
  folderRows,
  canUpload,
  canManage,
}: {
  gate: SubscriptionGate;
  upload: DocumentUpload;
  folders: readonly string[];
  typeOptions: readonly string[];
  typeRows: readonly DocumentTypeRow[] | null;
  importContext: ImportContext;
  documents: readonly ChapterDocument[];
  folderRows: readonly FolderRow[];
  /** `chapter_docs:upload`: Upload and Import a folder. */
  canUpload: boolean;
  /** `chapter_docs:manage`: Google Drive. */
  canManage: boolean;
}) {
  const openImport = useRef<(() => void) | null>(null);
  const openDrive = useRef<(() => void) | null>(null);
  const drive = useGoogleDriveStatus();
  const driveData = canManage ? drive.data : undefined;
  // The panel draws nothing while this server has no service account and
  // nothing is connected, so neither does its item.
  const showDrive =
    !!driveData && (driveData.available || !!driveData.connection);
  const driveNeedsAttention = driveData?.connection?.status === "no_access";
  const hasMenu = canUpload || showDrive;
  if (!hasMenu) return null;

  return (
    <div className="flex items-center">
      {canUpload ? (
        <UploadDocumentPanel
          gate={gate}
          upload={upload}
          folders={folders}
          typeOptions={typeOptions}
          typeRows={typeRows}
          triggerClassName="rounded-r-none"
        />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="toolbar"
            className={canUpload ? "-ml-px rounded-l-none px-2" : "gap-2"}
            aria-label={
              driveNeedsAttention
                ? "More ways to add documents: Google Drive needs attention"
                : "More ways to add documents"
            }
          >
            {canUpload ? null : "Add documents"}
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
            {driveNeedsAttention ? (
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-destructive"
              />
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          {canUpload ? (
            <DropdownMenuItem
              disabled={!gate.allowed}
              onSelect={() => openImport.current?.()}
            >
              <FolderUp className="h-4 w-4" aria-hidden="true" />
              Import a folder
            </DropdownMenuItem>
          ) : null}
          {showDrive ? (
            <DropdownMenuItem
              disabled={!gate.allowed}
              onSelect={() => openDrive.current?.()}
            >
              <FolderSync className="h-4 w-4" aria-hidden="true" />
              {driveData?.connection ? "Google Drive" : "Connect Google Drive"}
              {driveNeedsAttention ? (
                <span className="sr-only">: needs attention</span>
              ) : null}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canUpload ? (
        <FolderImportPanel
          gate={gate}
          context={importContext}
          openerRef={openImport}
        />
      ) : null}
      {canManage ? (
        <DriveFolderPanel
          gate={gate}
          documents={documents}
          folders={folderRows}
          openerRef={openDrive}
        />
      ) : null}
    </div>
  );
}
