"use client";

import { useId, useMemo, useState } from "react";
import {
  useChapterRoster,
  useMarkAttendanceByHand,
  type MeetingMinutes,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { MEETING_ATTENDANCE_COPY } from "@repo/validation";
import { dashboardTableCheckboxClassName } from "@/components/shared/table-controls";
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
import { SegmentedChoice } from "@/components/ui/segmented";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

type Status = "PRESENT" | "LATE" | "EXCUSED";

/**
 * Mark who was at a meeting by hand, for the meeting nobody checked in to
 * (Paul, 2026-11-16; `spec/behavior/events.md` § Marking attendance by
 * hand). One request writes the event's attendance for everyone picked. It
 * only fills in: someone already marked (a check-in, an excuse) is shown
 * and can't be picked, so a check-in is never overwritten. Like every
 * officer mark it moves no points. It opens from the minutes' ⋯ menu,
 * "Mark who was there", the same item the phone's menu has (#5562).
 */
export function AttendanceBackfill({
  eventId,
  attendees,
  onMarked,
  open,
  onOpenChange: setOpen,
}: {
  eventId: string;
  attendees: MeetingMinutes["attendees"];
  onMarked: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ids = useId();
  const { toast } = useToast();
  const roster = useChapterRoster();
  const mark = useMarkAttendanceByHand();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status>("PRESENT");
  const saving = mark.isPending;

  const already = useMemo(
    () =>
      new Set([
        ...(attendees?.present ?? []),
        ...(attendees?.late ?? []),
        ...(attendees?.excused ?? []),
      ]),
    [attendees],
  );
  const members = useMemo(
    () =>
      (roster.data ?? [])
        .map((row) => ({
          id: row.user_id,
          name: memberLabel(row.display_name, row.user_id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [roster.data],
  );
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? members.filter((member) => member.name.toLowerCase().includes(needle))
    : members;
  const pickable = shown.filter((member) => !already.has(member.id));
  const allShownPicked =
    pickable.length > 0 && pickable.every((member) => picked.has(member.id));

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleShown() {
    setPicked((current) => {
      const next = new Set(current);
      for (const member of pickable) {
        if (allShownPicked) next.delete(member.id);
        else next.add(member.id);
      }
      return next;
    });
  }

  async function save() {
    const userIds = [...picked].filter((id) => !already.has(id));
    if (userIds.length === 0) return;
    try {
      const result = await mark.mutateAsync({ eventId, userIds, status });
      onMarked();
      toast({
        title: MEETING_ATTENDANCE_COPY.marked(result.marked.length),
        description:
          result.not_invited > 0
            ? MEETING_ATTENDANCE_COPY.notInvited(result.not_invited)
            : undefined,
      });
      setPicked(new Set());
      setFilter("");
      setOpen(false);
    } catch (error) {
      toast({
        title: MEETING_ATTENDANCE_COPY.failed,
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{MEETING_ATTENDANCE_COPY.title}</DialogTitle>
          <DialogDescription>{MEETING_ATTENDANCE_COPY.body}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <SegmentedChoice
            label={MEETING_ATTENDANCE_COPY.statusLabel}
            value={status}
            onChange={setStatus}
            options={[
              { value: "PRESENT", label: "Present" },
              { value: "LATE", label: "Late" },
              { value: "EXCUSED", label: "Excused" },
            ]}
          />
          <Input
            aria-label={MEETING_ATTENDANCE_COPY.find}
            placeholder={MEETING_ATTENDANCE_COPY.find}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <label className="flex min-h-9 cursor-pointer items-center gap-2 px-2 text-sm font-semibold pointer-coarse:min-h-11">
            <input
              type="checkbox"
              checked={allShownPicked}
              disabled={pickable.length === 0}
              onChange={toggleShown}
              className={dashboardTableCheckboxClassName}
            />
            {needle
              ? MEETING_ATTENDANCE_COPY.pickShown(pickable.length)
              : MEETING_ATTENDANCE_COPY.pickEveryone}
          </label>
          <ul
            role="list"
            aria-label={MEETING_ATTENDANCE_COPY.title}
            className="grid max-h-72 gap-0.5 overflow-y-auto"
          >
            {shown.map((member) => (
              <li key={member.id}>
                <label
                  htmlFor={`${ids}-${member.id}`}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-card-hover pointer-coarse:min-h-11"
                >
                  <input
                    id={`${ids}-${member.id}`}
                    type="checkbox"
                    checked={picked.has(member.id) || already.has(member.id)}
                    disabled={already.has(member.id)}
                    onChange={() => toggle(member.id)}
                    className={dashboardTableCheckboxClassName}
                  />
                  <span className="min-w-0 flex-1 truncate">{member.name}</span>
                  {already.has(member.id) ? (
                    <span className="text-caption text-muted-foreground">
                      {MEETING_ATTENDANCE_COPY.alreadyMarked}
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={saving || picked.size === 0}
            onClick={() => void save()}
          >
            {MEETING_ATTENDANCE_COPY.save(picked.size, status)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
