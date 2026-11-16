"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useCreateDocumentFolder,
  useDeleteDocumentFolder,
  useUpdateDocumentFolder,
} from "@repo/hooks";
import { isEmptyChannelAccessChoice } from "@repo/hooks/channel-access";
import { tierByMarks } from "@repo/hooks/document-library";
import { sameChannelAccessList } from "@repo/validation";
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
import { ChannelAccessField } from "@/components/chat-admin/channel-access-field";
import {
  FOLDER_ALWAYS_LINE,
  useDocumentAccessChoices,
} from "@/components/documents/document-access";

/** The folder dialog's draft; `whoCanSee` `null` is everyone (#3642 piece 1). */
type FolderDraft = {
  id: string | null;
  name: string;
  whoCanSee: string[] | null;
};

const EMPTY_FOLDER_DRAFT: FolderDraft = { id: null, name: "", whoCanSee: null };

/**
 * Folder writes — create, edit, reorder, delete — and the one dialog that
 * serves create and edit (its name and who can see it). The rail and the dialog both read from what this
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
  const [folderDraft, setFolderDraft] =
    useState<FolderDraft>(EMPTY_FOLDER_DRAFT);
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
    setFolderDraft({
      id: folder?.id ?? null,
      name: folder?.name ?? "",
      whoCanSee: folder?.who_can_see ?? null,
    });
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
    const editing = folderDraft.id !== null;
    const previous = editing
      ? (folders.find((folder) => folder.id === folderDraft.id) ?? null)
      : null;
    const previousName = previous?.name ?? null;
    /*
      Only what changed is sent: a rename re-files the folder's documents,
      and an unchanged list is no write at all, so saving a dialog opened
      only to look sends nothing.
    */
    const renamed = editing && name !== previousName;
    const accessChanged =
      editing &&
      !sameChannelAccessList(
        folderDraft.whoCanSee,
        previous?.who_can_see ?? null,
      );
    // An empty Chosen list is refused by the API; Save waits for an entry.
    if (isEmptyChannelAccessChoice(folderDraft.whoCanSee)) return;
    if (editing && !renamed && !accessChanged) {
      folderDialog.setOpen(false);
      setFolderDraft(EMPTY_FOLDER_DRAFT);
      return;
    }
    if (!beginFolderWrite()) return;
    try {
      if (editing) {
        await updateFolder.mutateAsync({
          id: folderDraft.id!,
          ...(renamed ? { name } : {}),
          ...(accessChanged ? { who_can_see: folderDraft.whoCanSee } : {}),
        });
      } else {
        await createFolder.mutateAsync({
          name,
          ...(folderDraft.whoCanSee !== null
            ? { who_can_see: folderDraft.whoCanSee }
            : {}),
        });
      }
      toast({
        title: !editing
          ? "Folder created"
          : renamed
            ? "Folder renamed"
            : "Saved who can see it",
        description: !editing
          ? `"${name}" is ready to file documents into.`
          : renamed
            ? `Documents in this folder now read "${name}".`
            : folderDraft.whoCanSee === null
              ? `Everyone who can open Documents sees ${name}.`
              : `Only the people chosen see ${name} and what's in it.`,
      });
      // A rename re-files documents server-side, so a tab still pointing at the
      // old name would filter to nothing. Follow the folder rather than reset.
      if (renamed && activeFolder === previousName) setActiveFolder(name);
      folderDialog.setOpen(false);
      setFolderDraft(EMPTY_FOLDER_DRAFT);
    } catch (error) {
      // The API answers a duplicate name with 409 and a readable body
      // (`A folder named "X" already exists`), which `getErrorMessage` surfaces
      // verbatim — the fallback is for the network-failure case only.
      toast({
        title: editing ? "Couldn't save folder" : "Couldn't create folder",
        description: getErrorMessage(error, "Try again in a moment."),
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
        description: getErrorMessage(error, "Try again in a moment."),
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
  async function handleMoveFolder(folderId: string, direction: -1 | 1) {
    /*
      A folder moves within its own tier (#3934): pinned folders among the
      pinned, the rest among the rest, since the rail always draws the pinned
      ones first. The whole arrangement is then written as pinned-then-rest,
      so `sort_order` and what everyone sees stay one order.
    */
    const { pinned, rest } = splitPinned(folders);
    const group = pinned.some((folder) => folder.id === folderId)
      ? pinned
      : rest;
    const index = group.findIndex((folder) => folder.id === folderId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= group.length) return;
    const moved = group[index];
    if (!moved) return;
    const regrouped = [...group];
    regrouped.splice(index, 1);
    regrouped.splice(target, 0, moved);
    const reordered =
      group === pinned ? [...regrouped, ...rest] : [...pinned, ...regrouped];

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
            : getErrorMessage(error, "Try again in a moment."),
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

/**
 * The chapter's folders as officers arrange them: the pinned ones first, each
 * group in its stored order (#3934). Stars are left out on purpose: they are
 * one member's, and the arrangement is everyone's.
 */
export function splitPinned<F extends { pinned_at?: string | null }>(
  folders: readonly F[],
): { pinned: F[]; rest: F[] } {
  const { pinned, rest } = tierByMarks(
    folders,
    (folder) => !!folder.pinned_at,
    () => false,
  );
  return { pinned, rest };
}

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
  const access = useDocumentAccessChoices(folderDialog.open);

  /*
    Controlled with no `DialogTrigger` — it is opened from any of the
    per-folder rename buttons or the header's New folder button, so there is
    no single trigger element to wrap.
  */
  return (
    <Dialog {...folderDialog.dialogProps}>
      <DialogContent {...folderDialog.contentProps}>
        <DialogHeader>
          <DialogTitle>
            {folderDraft.id ? "Edit folder" : "New folder"}
          </DialogTitle>
          <DialogDescription>
            {folderDraft.id
              ? "Renaming re-files every document in it. Who can see it reaches every file inside."
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
          {/*
            Left out for a member outside the tiers, who may not set a list
            (the API refuses), rather than offered and refused on save. On a
            folder that already has one they may still open it to everyone.
          */}
          {access.canLimit || folderDraft.whoCanSee !== null ? (
            <ChannelAccessField
              id="doc-folder-access"
              question="see"
              value={folderDraft.whoCanSee}
              onChange={(next) =>
                setFolderDraft((prev) => ({ ...prev, whoCanSee: next }))
              }
              options={access.options}
              optionsState={access.optionsState}
              locked={access.locked}
              alwaysLine={FOLDER_ALWAYS_LINE}
              canChoose={access.canLimit}
              disabled={folderBusy || access.optionsState === "loading"}
            />
          ) : null}
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
            {...gate.controlProps(
              folderBusy ||
                !folderDraft.name.trim() ||
                isEmptyChannelAccessChoice(folderDraft.whoCanSee),
            )}
          >
            {folderBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {folderDraft.id ? "Save folder" : "Create folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
