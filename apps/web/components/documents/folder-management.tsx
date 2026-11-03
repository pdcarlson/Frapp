"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useCreateDocumentFolder,
  useDeleteDocumentFolder,
  useUpdateDocumentFolder,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  useGatedDialog,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import type {
  ChapterDocumentFolder,
  FolderRow,
} from "@/components/documents/document-types";

/**
 * Folder writes — create, rename, reorder, delete — and the one dialog that
 * serves create and rename. The rail and the dialog both read from what this
 * returns, so the busy flag they disable on is a single value.
 */
export function useFolderManagement({
  gate,
  folders,
  activeFolder,
  setActiveFolder,
  confirm,
  refetchFolders,
}: {
  gate: SubscriptionGate;
  folders: ChapterDocumentFolder[];
  activeFolder: string | null;
  setActiveFolder: (folder: string | null) => void;
  confirm: ReturnType<typeof useConfirmDialog>["confirm"];
  refetchFolders: () => unknown;
}) {
  const { toast } = useToast();
  const createFolder = useCreateDocumentFolder();
  const updateFolder = useUpdateDocumentFolder();
  const deleteFolder = useDeleteDocumentFolder();

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
            ? "Some folders moved before this failed. The list below shows the order that saved."
            : getErrorMessage(
                error,
                "Requires chapter_docs:manage. Retry or confirm your permissions.",
              ),
        variant: "destructive",
      });
      void refetchFolders();
    } finally {
      endFolderWrite();
    }
  }

  return {
    folderDialog,
    folderDraft,
    setFolderDraft,
    folderBusy,
    openFolderDialog,
    handleSaveFolder,
    handleDeleteFolder,
    handleMoveFolder,
  };
}

export type FolderManagement = ReturnType<typeof useFolderManagement>;

export function FolderDialog({
  gate,
  management,
}: {
  gate: SubscriptionGate;
  management: FolderManagement;
}) {
  const {
    folderDialog,
    folderDraft,
    setFolderDraft,
    folderBusy,
    handleSaveFolder,
  } = management;

  /*
    Controlled with no `DialogTrigger` — it is opened from any of the
    per-folder rename buttons or the header's New folder button, so there is
    no single trigger element to wrap.
  */
  return (
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
  );
}
