"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  useEvent,
  useRoles,
  useUpdateEvent,
  type MeetingMinutes,
} from "@repo/hooks";
import { toRoleOptions } from "@repo/hooks/chapter-roles";
import {
  MEETING_OTHER_LABEL_MAX_LENGTH,
  MEETING_TYPES,
  MEETING_TYPE_LABELS,
  MINUTES_READ_COPY,
  STANDARDS_MEETING_NOTE,
  eventOthersInvited,
  type MeetingType,
} from "@repo/validation";
import { inlineNoteActionClassName } from "@/components/shared/inline-note";
import { FieldError } from "@/components/shared/short-form";
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
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented";
import { isoToLocalInput } from "@/components/events/local-input";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

const copy = MINUTES_READ_COPY.details;

export type MinutesTypeValue = {
  meeting_type: MeetingType;
  other_label: string;
};

/**
 * Edit details from the minutes' ⋯ menu (#5562; Paul, 2026-11-19: "a more
 * button in the top right with options like editing the name, the
 * attendees, the type, visibility"). The meeting's facts in one form, the
 * same fields in the same order as the phone's sheet. The name, the time
 * and who reads belong to the meeting's event, so they save to the event
 * and need `events:update`; the type is the minutes' own.
 */
export function MinutesDetailsDialog({
  meeting,
  open,
  onOpenChange,
  type,
  canEditEvent,
  onSaveType,
  onEventSaved,
}: {
  meeting: MeetingMinutes;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: MinutesTypeValue;
  canEditEvent: boolean;
  /** Saves the type; answers whether it landed. */
  onSaveType: (next: MinutesTypeValue) => Promise<boolean>;
  onEventSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {open ? (
          <DetailsForm
            meeting={meeting}
            type={type}
            canEditEvent={canEditEvent && !!meeting.event_id}
            onSaveType={onSaveType}
            onEventSaved={onEventSaved}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailsForm({
  meeting,
  type,
  canEditEvent,
  onSaveType,
  onEventSaved,
  onDone,
}: {
  meeting: MeetingMinutes;
  type: MinutesTypeValue;
  canEditEvent: boolean;
  onSaveType: (next: MinutesTypeValue) => Promise<boolean>;
  onEventSaved: () => void;
  onDone: () => void;
}) {
  const ids = useId();
  const { toast } = useToast();
  const updateEvent = useUpdateEvent();
  const event = useEvent(meeting.event_id ?? "");
  const roles = useRoles();
  const startAt = isoToLocalInput(meeting.event_start_time);
  const endAt = isoToLocalInput(meeting.event_end_time);
  const [name, setName] = useState(meeting.event_name);
  const [start, setStart] = useState(startAt);
  const [end, setEnd] = useState(endAt);
  const [nextType, setNextType] = useState(type);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  const nameMissing = canEditEvent && name.trim().length === 0;
  const endBeforeStart =
    canEditEvent && !!start && !!end && Date.parse(end) <= Date.parse(start);
  const eventChanged =
    canEditEvent &&
    (name.trim() !== meeting.event_name ||
      start !== startAt ||
      (end !== endAt && !!end));
  const typeChanged =
    nextType.meeting_type !== type.meeting_type ||
    (nextType.meeting_type === "other" &&
      nextType.other_label.trim() !== type.other_label.trim());

  const roleNames = (() => {
    const data = event.data;
    if (!data || eventOthersInvited(data)) return null;
    const byId = new Map(
      toRoleOptions(roles.data).map((role) => [role.id, role.name]),
    );
    const names = [
      ...(data.required_role_ids ?? []),
      ...(data.optional_role_ids ?? []),
    ]
      .map((id) => byId.get(id))
      .filter((value): value is string => !!value);
    return names.length > 0 ? names.join(", ") : null;
  })();

  async function save() {
    setTried(true);
    if (nameMissing || endBeforeStart) return;
    if (!eventChanged && !typeChanged) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      if (eventChanged && meeting.event_id) {
        await updateEvent.mutateAsync({
          id: meeting.event_id,
          body: {
            name: name.trim(),
            start_time: new Date(start).toISOString(),
            ...(end ? { end_time: new Date(end).toISOString() } : {}),
          },
        });
        onEventSaved();
      }
      if (typeChanged && !(await onSaveType(nextType))) return;
      toast({ title: copy.saved });
      onDone();
    } catch (error) {
      toast({
        title: copy.saveFailed,
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>
          {canEditEvent ? copy.eventNote : copy.eventOnly}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        {canEditEvent ? (
          <>
            <div className="grid gap-1">
              <Label htmlFor={`${ids}-name`}>{copy.name}</Label>
              <Input
                id={`${ids}-name`}
                value={name}
                onChange={(next) => setName(next.target.value)}
              />
              {tried && nameMissing ? (
                <FieldError>{copy.nameRequired}</FieldError>
              ) : null}
            </div>
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">{copy.when}</legend>
              <div className="grid min-w-0 gap-1">
                <Label htmlFor={`${ids}-start`}>{copy.starts}</Label>
                <Input
                  id={`${ids}-start`}
                  type="datetime-local"
                  value={start}
                  onChange={(next) => {
                    const value = next.target.value;
                    // The meeting keeps its length when its start moves, as
                    // on the phone.
                    const moved = Date.parse(value) - Date.parse(start);
                    if (end && Number.isFinite(moved)) {
                      setEnd(
                        isoToLocalInput(
                          new Date(Date.parse(end) + moved).toISOString(),
                        ),
                      );
                    }
                    setStart(value);
                  }}
                />
              </div>
              <div className="grid min-w-0 gap-1">
                <Label htmlFor={`${ids}-end`}>{copy.ends}</Label>
                <Input
                  id={`${ids}-end`}
                  type="datetime-local"
                  value={end}
                  onChange={(next) => setEnd(next.target.value)}
                />
              </div>
              {tried && endBeforeStart ? (
                <FieldError>{copy.endBeforeStart}</FieldError>
              ) : null}
            </fieldset>
          </>
        ) : null}
        <div className="grid gap-2">
          <Label id={`${ids}-type`}>{copy.type}</Label>
          <SegmentedChoice
            label={copy.type}
            value={nextType.meeting_type}
            onChange={(meeting_type) =>
              setNextType((current) => ({ ...current, meeting_type }))
            }
            options={MEETING_TYPES.map((value) => ({
              value,
              label: MEETING_TYPE_LABELS[value],
            }))}
          />
          {nextType.meeting_type === "other" ? (
            <div className="grid max-w-sm gap-1">
              <Label htmlFor={`${ids}-other`}>{copy.otherLabel}</Label>
              <Input
                id={`${ids}-other`}
                value={nextType.other_label}
                maxLength={MEETING_OTHER_LABEL_MAX_LENGTH}
                onChange={(next) =>
                  setNextType((current) => ({
                    ...current,
                    other_label: next.target.value,
                  }))
                }
              />
            </div>
          ) : null}
          <p className="text-caption text-muted-foreground">
            {STANDARDS_MEETING_NOTE}
          </p>
        </div>
        {meeting.event_id ? (
          <div className="grid gap-1">
            <span className="text-sm font-medium">{copy.whoCanRead}</span>
            <p className="text-sm">
              {roleNames ? copy.someRoles(roleNames) : copy.everyone}
            </p>
            {canEditEvent ? (
              // Who an event invites has its own controls in the event's
              // editor (required, optional, kept out); one set of them,
              // not a second copy here.
              <Link
                href={`/events?event=${meeting.event_id}`}
                className={inlineNoteActionClassName}
              >
                {copy.changeWho}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={saving} onClick={() => void save()}>
          {copy.save}
        </Button>
      </DialogFooter>
    </>
  );
}
