"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarPlus2, Loader2, Save } from "lucide-react";
import { useCreateEvent, useUpdateEvent } from "@repo/hooks";
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
import { dashboardFilterSelectClassName } from "@/components/shared/table-controls";

type EventRecord = Record<string, unknown>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please retry.";
}

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
  mode: "create" | "edit";
  event: EventRecord | null;
  usingPreviewData: boolean;
  onSaved: () => Promise<void> | void;
};

export function EventEditorDialog({
  open,
  onOpenChange,
  mode,
  event,
  usingPreviewData,
  onSaved,
}: EventEditorDialogProps) {
  const createEventMutation = useCreateEvent();
  const updateEventMutation = useUpdateEvent();
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

  const eventId = typeof event?.id === "string" ? event.id : "";
  const isSubmitting = createEventMutation.isPending || updateEventMutation.isPending;

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
  }, [event, mode, open]);

  const submitLabel = useMemo(() => {
    if (isSubmitting) {
      return mode === "create" ? "Creating..." : "Saving...";
    }
    return mode === "create" ? "Create event" : "Save changes";
  }, [isSubmitting, mode]);

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
        await createEventMutation.mutateAsync(payload);
        toast({
          title: "Event created",
          description: `${payload.name} was added to the chapter calendar.`,
        });
      } else {
        if (!eventId) return;
        await updateEventMutation.mutateAsync({
          id: eventId,
          body: payload,
        });
        toast({
          title: "Event updated",
          description: `${payload.name} was updated successfully.`,
        });
      }
    } catch (error) {
      toast({
        title: mode === "create" ? "Could not create event" : "Could not update event",
        description: getErrorMessage(error),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
                onChange={(eventValue) => {
                  const parsed = Number(eventValue.target.value);
                  if (Number.isNaN(parsed)) return;
                  setPointValue(Math.max(0, parsed));
                }}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={usingPreviewData || isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
