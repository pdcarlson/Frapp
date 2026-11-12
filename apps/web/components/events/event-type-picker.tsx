"use client";

import React, { useState } from "react";
import {
  Check,
  Loader2,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  useCreateEventType,
  useDeleteEventType,
  useEventTypes,
  useUpdateEventType,
  type EventType,
} from "@repo/hooks";
import { EVENT_TYPE_NAME_MAX_LENGTH, EVENT_TYPES_MAX } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/lib/hooks/use-toast";
import {
  cn,
  getErrorMessage,
  guardIntDraft,
  parseGuardedInt,
} from "@/lib/utils";

/**
 * The Type row at the top of the event form (`spec/behavior/events.md`
 * § Event types): the chapter's kinds of event as one row of chips, none held
 * until the officer picks. Picking one is a shortcut, not a lock: the form
 * fills in the type's points and attendance and the officer can still change
 * either. Picking the held chip again lets it go.
 *
 * The chips are the Chip step (`foundations.md` §9: 24px, 12.5/600), held in
 * the accent tint as the Segmented control holds its answer, so the row reads
 * as one choice among several rather than as filters. Comparable: Google
 * Calendar's Event / Task / Out of office tabs at the top of its create
 * dialog, and Linear's label chips, which are edited from the same menu that
 * applies them.
 *
 * `canManage` (`events:update`) adds "Edit types" at the end of the row, a
 * popover listing the types with inline edit, add and delete, so an officer
 * who finds the list wrong fixes it where they noticed rather than in a
 * settings page.
 */
export function EventTypePicker({
  value,
  onPick,
  canManage,
  disabled = false,
}: {
  value: string | null;
  /** `null` when the held chip is let go. */
  onPick: (type: EventType | null) => void;
  canManage: boolean;
  disabled?: boolean;
}) {
  const typesQuery = useEventTypes();
  const types = typesQuery.data ?? [];
  // A chapter with no types and nobody to make them sees no row at all.
  if (!canManage && types.length === 0) return null;

  return (
    <div className="grid gap-1.5">
      <span id="event-type-label" className="text-sm font-semibold">
        Type
      </span>
      <div
        role="radiogroup"
        aria-labelledby="event-type-label"
        className="flex flex-wrap items-center gap-1.5"
      >
        {typesQuery.isLoading ? (
          <span className="text-caption text-muted-foreground">
            Loading types
          </span>
        ) : null}
        {types.map((type) => {
          const held = type.id === value;
          return (
            <button
              key={type.id}
              type="button"
              role="radio"
              aria-checked={held}
              disabled={disabled}
              title={describeEventType(type)}
              onClick={() => onPick(held ? null : type)}
              className={cn(
                CHIP,
                held
                  ? "border-accent-border bg-accent-subtle text-accent-text"
                  : "border-input bg-surface-1 text-muted-foreground hover:bg-card-hover hover:text-foreground",
              )}
            >
              {held ? <Check className="h-3 w-3" aria-hidden /> : null}
              {type.name}
            </button>
          );
        })}
        {canManage ? (
          <EventTypesEditor types={types} disabled={disabled} />
        ) : null}
      </div>
    </div>
  );
}

/** "10 points, required for everyone": a type's chip title and editor row. */
function describeEventType(type: {
  point_value: number;
  is_mandatory: boolean;
}): string {
  const points =
    type.point_value === 1 ? "1 point" : `${type.point_value} points`;
  return `${points}, ${type.is_mandatory ? "required" : "optional"} for everyone`;
}

const CHIP = cn(
  "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[9px] border px-2 text-caption font-semibold transition-colors pointer-coarse:h-8",
  "disabled:pointer-events-none disabled:text-disabled",
  FOCUS_RING,
);

type Draft = { name: string; points: string; required: boolean };

const ATTENDANCE_OPTIONS = [
  { value: "optional", label: "Optional" },
  { value: "required", label: "Required" },
] as const;

function EventTypesEditor({
  types,
  disabled,
}: {
  types: EventType[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Which row is open for editing: a type's id, "new", or none. One at a
  // time, so the list never turns into a wall of fields.
  const [editing, setEditing] = useState<string | null>(null);
  const atCap = types.length >= EVENT_TYPES_MAX;

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
            CHIP,
            "border-dashed border-input bg-transparent text-muted-foreground hover:bg-card-hover hover:text-foreground",
          )}
        >
          <Settings2 className="h-3 w-3" aria-hidden />
          Edit types
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-0">
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold">Event types</p>
          <p className="text-caption text-muted-foreground">
            Picking a type fills in its points and attendance. Events already
            made keep theirs.
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
                  ? `A chapter can have at most ${EVENT_TYPES_MAX} types.`
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

function TypeRow({ type, onEdit }: { type: EventType; onEdit: () => void }) {
  const deleteType = useDeleteEventType();
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
    <li className="group flex items-center gap-2 px-3 py-1">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{type.name}</p>
        <p className="truncate text-caption text-muted-foreground">
          {confirming
            ? "Its events keep their points and lose the type."
            : describeEventType(type)}
        </p>
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
          <IconButton label={`Edit ${type.name}`} onClick={onEdit}>
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

/** The inline form for one type: edit when `type` is set, add when `null`. */
function TypeForm({
  type,
  onDone,
}: {
  type: EventType | null;
  onDone: () => void;
}) {
  const createType = useCreateEventType();
  const updateType = useUpdateEventType();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => ({
    name: type?.name ?? "",
    points: String(type?.point_value ?? 5),
    required: type?.is_mandatory ?? false,
  }));
  const [error, setError] = useState<string | null>(null);
  const pending = createType.isPending || updateType.isPending;
  const idBase = type ? `event-type-${type.id}` : "event-type-new";

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      setError("Give the type a name.");
      return;
    }
    const points =
      draft.points.trim() === "" ? 0 : parseGuardedInt(draft.points);
    if (points === undefined) {
      setError("Points must be a whole number of 0 or more.");
      return;
    }
    const body = { name, point_value: points, is_mandatory: draft.required };
    try {
      if (type) await updateType.mutateAsync({ id: type.id, body });
      else await createType.mutateAsync(body);
      onDone();
    } catch (cause) {
      // A taken name is the likely refusal, and the server says which.
      toast({
        title: type ? "Couldn't save the type" : "Couldn't add the type",
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
        void save();
      }}
    >
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${idBase}-name`}>Name</Label>
          <Input
            id={`${idBase}-name`}
            autoFocus
            value={draft.name}
            maxLength={EVENT_TYPE_NAME_MAX_LENGTH}
            placeholder="Work party"
            onChange={(event) => {
              setError(null);
              setDraft((previous) => ({
                ...previous,
                name: event.target.value,
              }));
            }}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${idBase}-points`}>Points</Label>
          <Input
            id={`${idBase}-points`}
            type="number"
            min={0}
            value={draft.points}
            onChange={(event) => {
              const next = guardIntDraft(event.target.value);
              if (next === undefined) return;
              setError(null);
              setDraft((previous) => ({ ...previous, points: next }));
            }}
          />
        </div>
      </div>
      <SegmentedChoice
        label="Attendance for everyone"
        options={ATTENDANCE_OPTIONS}
        value={draft.required ? "required" : "optional"}
        onChange={(next) =>
          setDraft((previous) => ({
            ...previous,
            required: next === "required",
          }))
        }
        fill
      />
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
