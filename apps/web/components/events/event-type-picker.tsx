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
import {
  describeEventTypeSets,
  EVENT_FORM_PLACEHOLDERS,
  EVENT_FORM_ROW_LABELS,
  EVENT_TYPE_NAME_MAX_LENGTH,
  EVENT_TYPES_MAX,
} from "@repo/validation";
import {
  TypeListEditor,
  TypeListForm,
  TypeNameField,
} from "@/components/shared/type-list-editor";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PropertyRow,
  RowValueButton,
} from "@/components/events/event-form-rows";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn, guardIntDraft, parseGuardedInt } from "@/lib/utils";

/**
 * The Type row of the event form (`spec/behavior/events.md` § Event types,
 * #5561): the chapter's kinds of event in a menu that finds one as you type,
 * none held until the officer picks. Picking one is a shortcut, not a lock:
 * the form fills in the type's points and attendance and the officer can
 * still change either. "No type" lets the held one go.
 *
 * A menu rather than the row of chips it replaced: seven seeded types
 * already wrapped to two lines and a chapter may keep 30, pushing the name
 * down the form. Comparable: Linear's label and status menus, which search,
 * and Google Calendar's event-type tabs. Each type says what it sets ("10
 * points · Required", `describeEventTypeSets`, the words the phone's Type
 * sheet shows); a member, whose event carries neither, sees the names alone.
 *
 * `canManage` (`events:update`) adds "Edit types" at the row's end, the list
 * with inline edit, add and delete, so an officer who finds the list wrong
 * fixes it where they noticed rather than in a settings page. It renders the
 * shared `TypeListEditor` (#4723).
 */
export function EventTypeRow({
  value,
  onPick,
  canManage,
  showSets,
  disabled = false,
}: {
  value: string | null;
  /** `null` when the officer picks No type. */
  onPick: (type: EventType | null) => void;
  canManage: boolean;
  /** Whether each type says what it sets: not for a member (#3709). */
  showSets: boolean;
  disabled?: boolean;
}) {
  const typesQuery = useEventTypes();
  const types = typesQuery.data ?? [];
  const [open, setOpen] = useState(false);
  // A chapter with no types and nobody to make them sees no row at all.
  if (!canManage && types.length === 0) return null;
  const held = types.find((type) => type.id === value) ?? null;

  return (
    <PropertyRow
      glyph="type"
      label={EVENT_FORM_ROW_LABELS.type}
      trailing={
        canManage ? (
          <EventTypesEditor types={types} disabled={disabled} />
        ) : undefined
      }
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <RowValueButton
            empty={!held}
            disabled={disabled}
            aria-label={`Type: ${held?.name ?? "none"}`}
          >
            {typesQuery.isLoading
              ? "Loading types"
              : (held?.name ?? EVENT_FORM_PLACEHOLDERS.type)}
          </RowValueButton>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[22rem] p-0">
          <Command label="Event type">
            <CommandInput placeholder="Find a type" />
            <CommandList className="max-h-72">
              <CommandEmpty>No type by that name.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="No type"
                  onSelect={() => {
                    onPick(null);
                    setOpen(false);
                  }}
                  className="min-h-9 text-sm text-muted-foreground pointer-coarse:min-h-11"
                >
                  <span className="w-4" aria-hidden="true">
                    {held ? null : <Check className="h-4 w-4" />}
                  </span>
                  No type
                </CommandItem>
                {types.map((type) => (
                  <CommandItem
                    key={type.id}
                    value={type.name}
                    onSelect={() => {
                      onPick(type);
                      setOpen(false);
                    }}
                    className="min-h-9 text-sm pointer-coarse:min-h-11"
                  >
                    <span className="w-4 text-accent-text" aria-hidden="true">
                      {type.id === value ? <Check className="h-4 w-4" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{type.name}</span>
                    {showSets ? (
                      <span className="shrink-0 text-caption text-muted-foreground">
                        {describeEventTypeSets(type)}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </PropertyRow>
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
        "inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-md px-2 text-caption font-semibold text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground pointer-coarse:h-11",
        "disabled:pointer-events-none disabled:text-disabled",
        FOCUS_RING,
      )}
      widthClassName="w-[22rem]"
      title="Event types"
      blurb="Picking a type fills in its points and attendance. Events already made keep theirs."
      max={EVENT_TYPES_MAX}
      deleteConsequence="Its events keep their points and lose the type."
      describe={describeEventType}
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
