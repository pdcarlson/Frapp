"use client";

import React, { useState } from "react";
import { Loader2, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import {
  useCreateDocumentType,
  useDeleteDocumentType,
  useUpdateDocumentType,
  type DocumentTypeRow,
} from "@repo/hooks";
import {
  DOCUMENT_TYPE_NAME_MAX_LENGTH,
  DOCUMENT_TYPES_MAX,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";

/**
 * "Edit types" at the end of the upload panel's Type row, for officers with
 * `chapter_docs:manage` (#3642, `spec/behavior/chapter-docs.md` § Document
 * types): the chapter's document types with inline rename, add and delete, so
 * an officer who finds the list wrong fixes it where they noticed. The same
 * shape as the event form's "Edit types" (`event-type-picker.tsx`), after
 * Linear's labels, which are edited from the menu that applies them.
 */
export function DocumentTypesEditor({
  types,
  disabled,
  chipClassName,
}: {
  types: readonly DocumentTypeRow[];
  disabled: boolean;
  /** The row's chip classes, so the trigger sits in the row as a chip. */
  chipClassName: string;
}) {
  const [open, setOpen] = useState(false);
  // One row open at a time: a type's id, "new", or none.
  const [editing, setEditing] = useState<string | null>(null);
  const atCap = types.length >= DOCUMENT_TYPES_MAX;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditing(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            chipClassName,
            "gap-1 border-dashed bg-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Settings2 className="h-3 w-3" aria-hidden />
          Edit types
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[20rem] p-0">
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold">Document types</p>
          <p className="text-caption text-muted-foreground">
            Renaming a type renames it on its documents. Deleting one leaves
            its documents with no type.
          </p>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {types.map((type) =>
            editing === type.id ? (
              <li key={type.id} className="px-3 py-2">
                <TypeForm type={type} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <TypeRow
                key={type.id}
                type={type}
                onEdit={() => setEditing(type.id)}
              />
            ),
          )}
          {types.length === 0 ? (
            <li className="px-3 py-2 text-caption text-muted-foreground">
              No types yet.
            </li>
          ) : null}
        </ul>
        <div className="border-t border-border px-3 py-2">
          {editing === "new" ? (
            <TypeForm type={null} onDone={() => setEditing(null)} />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={atCap}
              title={
                atCap
                  ? `A chapter can have at most ${DOCUMENT_TYPES_MAX} types.`
                  : undefined
              }
              onClick={() => setEditing("new")}
              className="-ml-2"
            >
              <Plus className="h-4 w-4" />
              Add type
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TypeRow({
  type,
  onEdit,
}: {
  type: DocumentTypeRow;
  onEdit: () => void;
}) {
  const deleteType = useDeleteDocumentType();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    try {
      await deleteType.mutateAsync(type.id);
    } catch (error) {
      toast({
        title: "Couldn't delete the type",
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
      setConfirming(false);
    }
  }

  return (
    <li className="flex items-center gap-2 px-3 py-1">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{type.name}</p>
        {confirming ? (
          <p className="truncate text-caption text-muted-foreground">
            Its documents keep everything but the type.
          </p>
        ) : null}
      </div>
      {confirming ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={deleteType.isPending}
            onClick={() => void remove()}
          >
            {deleteType.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Delete
          </Button>
        </>
      ) : (
        <>
          <IconButton label={`Rename ${type.name}`} onClick={onEdit}>
            <Pencil />
          </IconButton>
          <IconButton
            label={`Delete ${type.name}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
          </IconButton>
        </>
      )}
    </li>
  );
}

/** The inline form for one type: rename when `type` is set, add when `null`. */
function TypeForm({
  type,
  onDone,
}: {
  type: DocumentTypeRow | null;
  onDone: () => void;
}) {
  const createType = useCreateDocumentType();
  const updateType = useUpdateDocumentType();
  const { toast } = useToast();
  const [name, setName] = useState(type?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const pending = createType.isPending || updateType.isPending;
  const id = type ? `document-type-${type.id}` : "document-type-new";

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the type a name.");
      return;
    }
    try {
      if (type) await updateType.mutateAsync({ id: type.id, name: trimmed });
      else await createType.mutateAsync({ name: trimmed });
      onDone();
    } catch (cause) {
      // A taken name is the likely refusal, and the server says which.
      toast({
        title: type ? "Couldn't rename the type" : "Couldn't add the type",
        description: getErrorMessage(
          cause,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        // The popover is portalled, but React still bubbles the submit up
        // its own tree to the upload form around the trigger, which would
        // start an upload.
        event.stopPropagation();
        void save();
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          autoFocus
          value={name}
          maxLength={DOCUMENT_TYPE_NAME_MAX_LENGTH}
          placeholder="Contract"
          onChange={(event) => {
            setError(null);
            setName(event.target.value);
          }}
        />
      </div>
      {error ? (
        <p className="text-caption text-destructive-text">{error}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          <X className="h-4 w-4" />
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {type ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}
