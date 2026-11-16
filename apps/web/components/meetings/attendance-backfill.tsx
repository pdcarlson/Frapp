"use client";

import { useId, useMemo, useState } from "react";
import {
  useChapterRoster,
  useUpdateAttendanceStatus,
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

type Status = "PRESENT" | "LATE" | "EXCUSED";

/** How many marks go out at once, so a 120-member chapter isn't 120 at once. */
const AT_ONCE = 6;

/**
 * Mark who was at a meeting by hand, for the meeting nobody checked in to
 * (Paul, 2026-11-16; `spec/behavior/meetings.md` § Attendees). It writes the
 * event's attendance, the same record checking in writes, so the minutes'
 * Attendees list, the event's attendance and points all agree. Someone
 * already marked keeps their mark unless they're picked again.
 */
export function AttendanceBackfill({
  eventId,
  attendees,
  onMarked,
}: {
  eventId: string;
  attendees: MeetingMinutes["attendees"];
  onMarked: () => void;
}) {
  const ids = useId();
  const { toast } = useToast();
  const roster = useChapterRoster();
  const mark = useUpdateAttendanceStatus();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status>("PRESENT");
  const [saving, setSaving] = useState(false);

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
  const allShownPicked =
    shown.length > 0 && shown.every((member) => picked.has(member.id));

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
      for (const member of shown) {
        if (allShownPicked) next.delete(member.id);
        else next.add(member.id);
      }
      return next;
    });
  }

  async function save() {
    const userIds = [...picked];
    if (userIds.length === 0) return;
    setSaving(true);
    let failed = 0;
    for (let at = 0; at < userIds.length; at += AT_ONCE) {
      const results = await Promise.allSettled(
        userIds
          .slice(at, at + AT_ONCE)
          .map((userId) =>
            mark.mutateAsync({ eventId, userId, body: { status } }),
          ),
      );
      failed += results.filter((result) => result.status === "rejected").length;
    }
    setSaving(false);
    onMarked();
    if (failed > 0) {
      toast({
        title: MEETING_ATTENDANCE_COPY.someFailed(failed, userIds.length),
        variant: "destructive",
      });
      return;
    }
    toast({ title: MEETING_ATTENDANCE_COPY.marked(userIds.length) });
    setPicked(new Set());
    setFilter("");
    setOpen(false);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {already.size > 0
          ? MEETING_ATTENDANCE_COPY.openMore
          : MEETING_ATTENDANCE_COPY.open}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{MEETING_ATTENDANCE_COPY.title}</DialogTitle>
            <DialogDescription>
              {MEETING_ATTENDANCE_COPY.body}
            </DialogDescription>
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
                disabled={shown.length === 0}
                onChange={toggleShown}
                className={dashboardTableCheckboxClassName}
              />
              {needle
                ? MEETING_ATTENDANCE_COPY.pickShown(shown.length)
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
                      checked={picked.has(member.id)}
                      onChange={() => toggle(member.id)}
                      className={dashboardTableCheckboxClassName}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {member.name}
                    </span>
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
    </>
  );
}
