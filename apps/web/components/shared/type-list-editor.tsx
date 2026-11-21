"use client";

import React, { useState, type ReactNode } from "react";
import { Loader2, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
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
 * The "Edit types" popover a chapter's list of types is edited from, opened
 * from the end of the row of chips that applies them (after Linear's labels,
 * which are edited from the menu that applies them): one row open at a time,
 * Add type disabled at the cap, a Keep / Delete confirm on each row, and an
 * inline form the caller fills (#4723). The documents upload panel's type row
 * (`document-types-editor.tsx`) and the event form's Type row
 * (`event-type-picker.tsx`) render it.
 */

/** What every editable type carries. */
export interface TypeListItem {
  id: string;
  name: string;
}

/**
 * A delete mutation's surface, as a TanStack `useMutation` returns it.
 *
 * @public Named by the exported `TypeListEditorProps`, so it stays exported
 * for callers that type their own delete hook.
 */
export interface TypeDeleteMutation {
  mutateAsync: (id: string) => Promise<unknown>;
  isPending: boolean;
}

export interface TypeListEditorProps<T extends TypeListItem> {
  types: readonly T[];
  disabled: boolean;
  /** The trigger chip's full classes. */
  triggerClassName: string;
  /** The popover's width class. */
  widthClassName: string;
  title: string;
  blurb: string;
  /** The most types a chapter may have; Add type disables there. */
  max: number;
  /** The line under a row's name while its delete is being confirmed. */
  deleteConsequence: string;
  /**
   * The line under a row's name the rest of the time; without it, a row shows
   * only its name until a delete is being confirmed.
   */
  describe?: (type: T) => string;
  /** The row's edit button label, from the type's name. */
  editLabel: (name: string) => string;
  /** One delete mutation per row, so only that row shows it pending. */
  useDeleteType: () => TypeDeleteMutation;
  /** The inline form: edit when `type` is set, add when `null`. */
  renderForm: (type: T | null, onDone: () => void) => ReactNode;
}

export function TypeListEditor<T extends TypeListItem>({
  types,
  disabled,
  triggerClassName,
  widthClassName,
  title,
  blurb,
  max,
  deleteConsequence,
  describe,
  editLabel,
  useDeleteType,
  renderForm,
}: TypeListEditorProps<T>) {
  const [open, setOpen] = useState(false);
  // One row open at a time: a type's id, "new", or none.
  const [editing, setEditing] = useState<string | null>(null);
  const atCap = types.length >= max;
  const done = () => setEditing(null);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditing(null);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className={triggerClassName}>
          <Settings2 className="h-3 w-3" aria-hidden />
          Edit types
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(widthClassName, "p-0")}>
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-caption text-muted-foreground">{blurb}</p>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {types.map((type) =>
            editing === type.id ? (
              <li key={type.id} className="px-3 py-2">
                {renderForm(type, done)}
              </li>
            ) : (
              <TypeListRow
                key={type.id}
                type={type}
                deleteConsequence={deleteConsequence}
                description={describe?.(type)}
                editLabel={editLabel}
                useDeleteType={useDeleteType}
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
            renderForm(null, done)
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={atCap}
              title={
                atCap ? `A chapter can have at most ${max} types.` : undefined
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

function TypeListRow({
  type,
  deleteConsequence,
  description,
  editLabel,
  useDeleteType,
  onEdit,
}: {
  type: TypeListItem;
  deleteConsequence: string;
  description: string | undefined;
  editLabel: (name: string) => string;
  useDeleteType: () => TypeDeleteMutation;
  onEdit: () => void;
}) {
  const deleteType = useDeleteType();
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
        {confirming || description !== undefined ? (
          <p className="truncate text-caption text-muted-foreground">
            {confirming ? deleteConsequence : description}
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
          <IconButton label={editLabel(type.name)} onClick={onEdit}>
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

/**
 * The inline form's frame: the caller's fields, the inline error, and
 * Cancel / Save (or Add). `onSave` returns false when the caller refused the
 * draft inline (it has set `error`); a thrown save is toasted under
 * `saveFailedTitle`, or "Couldn't add the type" when adding.
 */
export function TypeListForm({
  isNew,
  pending,
  error,
  saveFailedTitle,
  onSave,
  onDone,
  children,
}: {
  isNew: boolean;
  pending: boolean;
  error: string | null;
  saveFailedTitle: string;
  onSave: () => Promise<boolean>;
  onDone: () => void;
  children: ReactNode;
}) {
  const { toast } = useToast();

  async function save() {
    try {
      if (await onSave()) onDone();
    } catch (cause) {
      // A taken name is the likely refusal, and the server says which.
      toast({
        title: isNew ? "Couldn't add the type" : saveFailedTitle,
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
        // its own tree to any form around the trigger, which it would submit.
        event.stopPropagation();
        void save();
      }}
    >
      {children}
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
          {isNew ? "Add" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** The form's Name field. */
export function TypeNameField({
  id,
  value,
  maxLength,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  maxLength: number;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>Name</Label>
      <Input
        id={id}
        autoFocus
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
