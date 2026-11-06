"use client";

import { useEffect, useRef, useState } from "react";
import { FolderOpen, Upload } from "lucide-react";
import { MAX_BACKWORK_UPLOAD_LABEL } from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  collectFromDrop,
  collectFromList,
  type CollectedFiles,
} from "@/lib/backwork-bulk/collect-files";
import { cn } from "@/lib/utils";

/**
 * Where PDFs enter bulk upload: drop files or folders, or pick them. One
 * component for the three places it shows, so they look and behave alike:
 *
 * - `large`: bulk upload's empty state.
 * - `compact`: under bulk upload's queue, for adding more.
 * - `strip`: the slim row on `/backwork` that hands the files to bulk upload
 *   (2026-11-05 redesign).
 *
 * The drag-over state is neutral (`--card-hover`), like every other hover
 * (`foundations.md` §6). `disabled` (a lapsed chapter, offline) ignores drops
 * and disables the pickers; `describedBy` points at the notice that says why.
 */
export function BulkDropZone({
  onFiles,
  variant = "compact",
  disabled = false,
  describedBy,
  onRefusedDrop,
}: {
  onFiles: (collected: CollectedFiles) => void;
  variant?: "large" | "compact" | "strip";
  disabled?: boolean;
  describedBy?: string;
  /** A drop while `disabled`, so the caller can say why nothing happened. */
  onRefusedDrop?: () => void;
}) {
  const [over, setOver] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // `webkitdirectory` isn't in React's attribute types.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setOver(false);
    if (disabled) {
      // Still a drop target (`onDragOver` cancels it) so the browser doesn't
      // open the file in place of the page; the caller says why it's refused.
      onRefusedDrop?.();
      return;
    }
    // `collectFromDrop` takes the entries before its first await, while the
    // browser still holds them (`collect-files.ts`).
    void collectFromDrop(event.dataTransfer.items).then(onFiles, () =>
      onFiles({ files: [], skipped: 0, unreadable: 1 }),
    );
  }

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files) onFiles(collectFromList(Array.from(event.target.files)));
    event.target.value = "";
  }

  const pickers = (
    <div className={cn("flex flex-wrap gap-2", variant !== "strip" && "justify-center")}>
      <Button
        type="button"
        variant="secondary"
        size="toolbar"
        onClick={() => filesInput.current?.click()}
        className="gap-1.5"
        disabled={disabled}
        aria-describedby={describedBy}
      >
        <Upload className="h-4 w-4" aria-hidden="true" /> Choose PDFs
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="toolbar"
        onClick={() => folderInput.current?.click()}
        className="gap-1.5"
        disabled={disabled}
        aria-describedby={describedBy}
      >
        <FolderOpen className="h-4 w-4" aria-hidden="true" /> Choose a folder
      </Button>
    </div>
  );

  return (
    <div
      data-testid="bulk-drop-zone"
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "rounded-xl border border-dashed transition-colors",
        variant === "strip"
          ? "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2"
          : "flex flex-col items-center justify-center gap-3 text-center",
        variant === "large" && "min-h-[360px] p-10",
        variant === "compact" && "p-4",
        over ? "border-muted-foreground bg-card-hover" : "border-input bg-surface-1",
      )}
    >
      {variant === "large" ? (
        <>
          <Upload className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-label font-semibold text-foreground">Drop PDFs or folders of PDFs</p>
          <p className="max-w-sm text-caption text-muted-foreground">
            Up to {MAX_BACKWORK_UPLOAD_LABEL} each. You&apos;ll redact and describe each one, and the next one loads while you work.
          </p>
        </>
      ) : variant === "strip" ? (
        <p className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
          <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Drop PDFs or a folder here to upload them. You black out names on
            your device first.
          </span>
        </p>
      ) : (
        <p className="text-caption text-muted-foreground">Drop more here</p>
      )}
      {pickers}
      <input ref={filesInput} type="file" accept=".pdf,application/pdf" multiple hidden onChange={onPick} data-testid="bulk-file-input" />
      <input ref={folderInput} type="file" multiple hidden onChange={onPick} data-testid="bulk-folder-input" />
    </div>
  );
}
