"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarPlus2, Loader2, Save, Shield } from "lucide-react";
import { useCreateEvent, useRoles, useUpdateEvent } from "@repo/hooks";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { normalizeRoleOptions } from "@/lib/roles";
import { getErrorMessage } from "@/lib/utils";

type EventRecord = Record<string, unknown>;

function isoToLocalInput(value: unknown): string {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function localInputToIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

type EventEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Forwarded to the underlying `DialogContent`. `useGatedDialog` splits its
   * contract across `dialogProps` and `contentProps`; `events-page.tsx` owns
   * `open` while this component owns the content, so without this the revoke
   * path falls back to Radix's default and refocuses a "New Event" trigger that
   * just went `disabled` — dropping focus to `<body>`.
   */
  onCloseAutoFocus?: (event: Event) => void;
  mode: "create" | "edit";
  event: EventRecord | null;
  usingPreviewData: boolean;
  onSaved: () => Promise<void> | void;
};

export function EventEditorDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  mode,
  event,
  usingPreviewData,
  onSaved,
}: EventEditorDialogProps) {
  const createEventMutation = useCreateEvent();
  const updateEventMutation = useUpdateEvent();
  // `POST /v1/events` and `PATCH /v1/events/:id` carry no `@FreeTier`, so both
  // are paid-ops and this dialog has to mirror the subscription gate (#841).
  const gate = useSubscriptionGate();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [pointValue, setPointValue] = useState(10);
  const [isMandatory, setIsMandatory] = useState(true);
  const [recurrenceRule, setRecurrenceRule] = useState("NONE");
  const [notes, setNotes] = useState("");
  const [requiredRoleIds, setRequiredRoleIds] = useState<string[]>([]);
  const rolesQuery = useRoles();

  const eventId = typeof event?.id === "string" ? event.id : "";
  const isSubmitting = createEventMutation.isPending || updateEventMutation.isPending;

  const roleOptions = useMemo(
    () =>
      normalizeRoleOptions(rolesQuery.data).sort((first, second) =>
        first.name.localeCompare(second.name),
      ),
    [rolesQuery.data],
  );

  // Always render every selected role as a removable checkbox — including ids
  // not in the loaded role list (a since-deleted role, or any role while
  // useRoles is still loading/errored). Otherwise an invisible seeded id would
  // be unremovable yet still submitted, silently re-targeting the event.
  const displayedRoles = useMemo(() => {
    const known = new Set(roleOptions.map((role) => role.id));
    const extras = requiredRoleIds
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: `Role ${id.slice(0, 8)}` }));
    return [...roleOptions, ...extras];
  }, [roleOptions, requiredRoleIds]);

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate or reset the form when the dialog opens on a different event */
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && event) {
      setName(typeof event.name === "string" ? event.name : "");
      setDescription(typeof event.description === "string" ? event.description : "");
      setLocation(typeof event.location === "string" ? event.location : "");
      setStartAt(isoToLocalInput(event.start_time));
      setEndAt(isoToLocalInput(event.end_time));
      setPointValue(typeof event.point_value === "number" ? event.point_value : 10);
      setIsMandatory(typeof event.is_mandatory === "boolean" ? event.is_mandatory : true);
      setRecurrenceRule(
        typeof event.recurrence_rule === "string" && event.recurrence_rule.length > 0
          ? event.recurrence_rule
          : "NONE",
      );
      setNotes(typeof event.notes === "string" ? event.notes : "");
      setRequiredRoleIds(
        Array.isArray(event.required_role_ids)
          ? event.required_role_ids.filter(
              (id): id is string => typeof id === "string",
            )
          : [],
      );
      return;
    }

    setName("");
    setDescription("");
    setLocation("");
    setStartAt("");
    setEndAt("");
    setPointValue(10);
    setIsMandatory(true);
    setRecurrenceRule("NONE");
    setNotes("");
    setRequiredRoleIds([]);
  }, [event, mode, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submitLabel = useMemo(() => {
    if (isSubmitting) {
      return mode === "create" ? "Creating..." : "Saving...";
    }
    return mode === "create" ? "Create event" : "Save changes";
  }, [isSubmitting, mode]);

    const handlePointValueChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    if (Number.isNaN(parsed)) return;
    setPointValue(Math.max(0, parsed));
  };

  function handleRequiredRoleChange(roleId: string, isChecked: boolean) {
    if (isChecked) {
      setRequiredRoleIds((previous) => [...new Set([...previous, roleId])]);
      return;
    }
    setRequiredRoleIds((previous) => previous.filter((id) => id !== roleId));
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast({
        title: "Event name required",
        description: "Add a clear event title before saving.",
        variant: "destructive",
      });
      return;
    }
    const startIso = localInputToIso(startAt);
    const endIso = localInputToIso(endAt);
    if (!startIso || !endIso) {
      toast({
        title: "Valid schedule required",
        description: "Provide both start and end times.",
        variant: "destructive",
      });
      return;
    }
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      toast({
        title: "Valid schedule required",
        description: "End must be after start.",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      start_time: startIso,
      end_time: endIso,
      point_value: pointValue,
      is_mandatory: isMandatory,
      recurrence_rule: recurrenceRule === "NONE" ? undefined : recurrenceRule,
      notes: notes.trim() || undefined,
    };

    try {
      if (mode === "create") {
        // Omit required_role_ids when empty so a new event defaults to all
        // members; on update (below) we always send it, so an empty array
        // clears targeting. See spec/behavior/events.md.
        await createEventMutation.mutateAsync(
          requiredRoleIds.length > 0
            ? { ...payload, required_role_ids: requiredRoleIds }
            : payload,
        );
        toast({
          title: "Event created",
          description: `${payload.name} was added to the chapter calendar.`,
        });
      } else {
        if (!eventId) return;
        await updateEventMutation.mutateAsync({
          id: eventId,
          body: { ...payload, required_role_ids: requiredRoleIds },
        });
        toast({
          title: "Event updated",
          description: `${payload.name} was updated successfully.`,
        });
      }
    } catch (error) {
      toast({
        title: mode === "create" ? "Could not create event" : "Could not update event",
        description: getErrorMessage(error, "Something went wrong. Please retry."),
        variant: "destructive",
      });
      return;
    }

    onOpenChange(false);
    try {
      await onSaved();
    } catch {
      toast({
        title: "Event saved",
        description: "The event was saved, but this view could not refresh automatically.",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus2 className="h-4 w-4" />
            {mode === "create" ? "Create event" : "Edit event"}
          </DialogTitle>
          <DialogDescription>
            Configure scheduling, attendance rules, and points for this chapter event.
          </DialogDescription>
        </DialogHeader>

        {usingPreviewData ? (
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>Preview mode is active. Sign in to create and edit live events.</div>
          </div>
        ) : null}

        {/*
          §5 rule 1 wants the gate on the trigger, but "New Event" / "Edit"
          live in the parents that own `open` (events-page, event-detail-sheet),
          so the earliest point this component controls is the top of the form.
          The notice therefore states the blocker before anything is typed,
          rather than leaving the save button disabled with no reason.
        */}
        <SubscriptionNotice gate={gate} feature="managing events" />

        <div className="grid gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Event name</span>
            <Input
              value={name}
              onChange={(eventValue) => setName(eventValue.target.value)}
              placeholder="Chapter Meeting"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Start</span>
              <Input
                type="datetime-local"
                value={startAt}
                onChange={(eventValue) => setStartAt(eventValue.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">End</span>
              <Input
                type="datetime-local"
                value={endAt}
                onChange={(eventValue) => setEndAt(eventValue.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Location</span>
              <Input
                value={location}
                onChange={(eventValue) => setLocation(eventValue.target.value)}
                placeholder="Chapter House"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Point value</span>
              <Input
                type="number"
                min={0}
                value={pointValue}
                onChange={handlePointValueChange}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Attendance policy</span>
              <select
                value={isMandatory ? "mandatory" : "optional"}
                onChange={(eventValue) => setIsMandatory(eventValue.target.value === "mandatory")}
                className={dashboardFilterSelectClassName}
              >
                <option value="mandatory">Mandatory</option>
                <option value="optional">Optional</option>
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Recurrence</span>
              <select
                value={recurrenceRule}
                onChange={(eventValue) => setRecurrenceRule(eventValue.target.value)}
                className={dashboardFilterSelectClassName}
              >
                <option value="NONE">One-time</option>
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Bi-weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </label>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Required roles</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave all unchecked to require every member. Select roles to limit attendance and
              auto-absent to members holding any selected role.
            </p>
            {rolesQuery.isError ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                Couldn&apos;t load chapter roles, so the list below may be incomplete.
              </div>
            ) : null}
            {displayedRoles.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                {rolesQuery.isLoading
                  ? "Loading roles…"
                  : rolesQuery.isError
                    ? "Role targeting is unavailable right now."
                    : "No roles are available for this chapter yet."}
              </div>
            ) : (
              <div className="space-y-2">
                {displayedRoles.map((role) => (
                  <label
                    key={role.id}
                    className="flex cursor-pointer items-center justify-between rounded-md border border-border p-3 transition hover:bg-muted/40"
                  >
                    <span className="font-medium">{role.name}</span>
                    <input
                      type="checkbox"
                      className={dashboardTableCheckboxClassName}
                      checked={requiredRoleIds.includes(role.id)}
                      disabled={usingPreviewData}
                      onChange={(eventValue) =>
                        handleRequiredRoleChange(role.id, eventValue.target.checked)
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Description</span>
            <textarea
              value={description}
              onChange={(eventValue) => setDescription(eventValue.target.value)}
              rows={3}
              className="min-h-[96px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              placeholder="Discuss chapter priorities and attendance expectations."
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Internal notes</span>
            <textarea
              value={notes}
              onChange={(eventValue) => setNotes(eventValue.target.value)}
              rows={2}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              placeholder="Optional notes for event planners."
            />
          </label>
        </div>

        <DialogFooter>
          {/* Cancel only closes the dialog — gating the way out of a surface the
              gate just blocked would be a trap. */}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            {...gate.controlProps(usingPreviewData || isSubmitting)}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
