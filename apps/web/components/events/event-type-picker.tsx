"use client";

import React, { useState } from "react";
import { Check } from "lucide-react";
import {
  useCreateEventType,
  useDeleteEventType,
  useEventTypes,
  useUpdateEventType,
  type EventType,
} from "@repo/hooks";
import { EVENT_TYPE_NAME_MAX_LENGTH, EVENT_TYPES_MAX } from "@repo/validation";
import {
  TypeListEditor,
  TypeListForm,
  TypeNameField,
} from "@/components/shared/type-list-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn, guardIntDraft, parseGuardedInt } from "@/lib/utils";

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
 * settings page. It renders the shared `TypeListEditor` (#4723).
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
  return (
    <TypeListEditor
      types={types}
      disabled={disabled}
      triggerClassName={cn(
        CHIP,
        "border-dashed border-input bg-transparent text-muted-foreground hover:bg-card-hover hover:text-foreground",
      )}
      widthClassName="w-[22rem]"
      title="Event types"
      blurb="Picking a type fills in its points and attendance. Events already made keep theirs."
      max={EVENT_TYPES_MAX}
      deleteConsequence="Its events keep their points and lose the type."
      describe={describeEventType}
      rowClassName="group"
      editLabel={(name) => `Edit ${name}`}
      useDeleteType={useDeleteEventType}
      renderForm={(type, onDone) => <TypeForm type={type} onDone={onDone} />}
    />
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
  const [draft, setDraft] = useState<Draft>(() => ({
    name: type?.name ?? "",
    points: String(type?.point_value ?? 5),
    required: type?.is_mandatory ?? false,
  }));
  const [error, setError] = useState<string | null>(null);
  const idBase = type ? `event-type-${type.id}` : "event-type-new";

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      setError("Give the type a name.");
      return false;
    }
    const points =
      draft.points.trim() === "" ? 0 : parseGuardedInt(draft.points);
    if (points === undefined) {
      setError("Points must be a whole number of 0 or more.");
      return false;
    }
    const body = { name, point_value: points, is_mandatory: draft.required };
    if (type) await updateType.mutateAsync({ id: type.id, body });
    else await createType.mutateAsync(body);
    return true;
  }

  return (
    <TypeListForm
      isNew={!type}
      pending={createType.isPending || updateType.isPending}
      error={error}
      saveFailedTitle="Couldn't save the type"
      onSave={save}
      onDone={onDone}
    >
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <TypeNameField
          id={`${idBase}-name`}
          value={draft.name}
          maxLength={EVENT_TYPE_NAME_MAX_LENGTH}
          placeholder="Work party"
          onChange={(name) => {
            setError(null);
            setDraft((previous) => ({ ...previous, name }));
          }}
        />
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
    </TypeListForm>
  );
}
