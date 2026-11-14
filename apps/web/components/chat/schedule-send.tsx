"use client";

import { useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  CornerUpLeft,
  Paperclip,
} from "lucide-react";
import {
  formatScheduledFor,
  schedulePresets,
  scheduledFailureCopy,
  scheduledMessageExtras,
  scheduleTimeProblem,
  useDeleteScheduledMessage,
  useScheduledMessages,
  useSendScheduledMessageNow,
  useUpdateScheduledMessage,
  type ScheduledMessage,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { mentionPicksIn } from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Scheduling a chat message to post later (#4956), the way Slack's "Schedule
 * for later" works: a chevron beside Send opens the presets and a custom
 * time, and a line above the composer opens the member's Scheduled list for
 * the channel, where each can be edited, sent now or deleted.
 */

/** `YYYY-MM-DD` and `HH:MM` for a local date, as the native inputs take them. */
function localParts(at: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

/** The local instant a date input and a time input name; invalid when either is empty. */
function fromLocalParts(date: string, time: string): Date {
  if (!date || !time) return new Date(Number.NaN);
  const [y = Number.NaN, mo = Number.NaN, d = Number.NaN] = date
    .split("-")
    .map(Number);
  const [h = Number.NaN, mi = Number.NaN] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

/** A date and a time, with the reason the pair can't be used under them. */
function ScheduleTimeFields({
  date,
  time,
  onDate,
  onTime,
  problem,
}: {
  date: string;
  time: string;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  problem: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-date">Date</Label>
          <Input
            id="schedule-date"
            type="date"
            value={date}
            onChange={(event) => onDate(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-time">Time</Label>
          <Input
            id="schedule-time"
            type="time"
            value={time}
            onChange={(event) => onTime(event.target.value)}
          />
        </div>
      </div>
      {problem ? (
        <p role="alert" className="text-caption text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The chevron beside Send. Disabled with Send: there is nothing to schedule.
 * `onSchedule` resolves once the message is scheduled and the composer is
 * clear, and rejects to keep the menu's custom time open.
 */
export function ScheduleSendButton({
  disabled,
  onSchedule,
}: {
  disabled: boolean;
  onSchedule: (at: Date) => Promise<void>;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const presets = schedulePresets(now);
  const initial = localParts(presets[0].at);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [busy, setBusy] = useState(false);
  const at = fromLocalParts(date, time);
  const problem = scheduleTimeProblem(at, new Date());

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && setNow(new Date())}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-6 shrink-0 rounded-full pointer-coarse:h-11 pointer-coarse:w-8"
            aria-label="Schedule message"
            title="Schedule for later"
            disabled={disabled}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          <DropdownMenuLabel>Schedule message</DropdownMenuLabel>
          {presets.map((preset) => (
            <DropdownMenuItem
              key={preset.key}
              onSelect={() => void onSchedule(preset.at).catch(() => {})}
            >
              {preset.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              const parts = localParts(presets[0].at);
              setDate(parts.date);
              setTime(parts.time);
              setCustomOpen(true);
            }}
          >
            Custom time…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={customOpen}
        onOpenChange={(open) => !busy && setCustomOpen(open)}
      >
        <DialogContent className="max-w-sm">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (problem) return;
              setBusy(true);
              void onSchedule(at)
                .then(() => setCustomOpen(false))
                .catch(() => {})
                .finally(() => setBusy(false));
            }}
          >
            <DialogHeader>
              <DialogTitle>Schedule message</DialogTitle>
              <DialogDescription>
                It posts as you at this time, on your clock.
              </DialogDescription>
            </DialogHeader>
            <ScheduleTimeFields
              date={date}
              time={time}
              onDate={setDate}
              onTime={setTime}
              problem={date && time ? problem : null}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCustomOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || problem !== null}>
                Schedule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * "2 scheduled messages" above the composer, while the member has any in this
 * channel; it opens the list. Nothing at all when they have none.
 */
export function ScheduledMessagesBar({ channelId }: { channelId: string }) {
  const { data } = useScheduledMessages(channelId);
  const [open, setOpen] = useState(false);
  const rows = data ?? [];
  if (rows.length === 0) return null;
  const failed = rows.filter((row) => row.status === "failed").length;
  const label =
    rows.length === 1
      ? "1 scheduled message"
      : `${rows.length} scheduled messages`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-3 mb-1 flex items-center gap-1.5 self-start rounded-md px-1.5 py-0.5 text-caption text-muted-foreground hover:text-foreground"
        data-scheduled-bar=""
      >
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{label}</span>
        {failed > 0 ? (
          <span className="text-destructive">· {failed} not sent</span>
        ) : null}
      </button>
      <ScheduledMessagesDialog open={open} onOpenChange={setOpen} rows={rows} />
    </>
  );
}

function ScheduledMessagesDialog({
  open,
  onOpenChange,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ScheduledMessage[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const now = new Date();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setEditing(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Scheduled messages</DialogTitle>
          <DialogDescription>
            Only you see these. Each posts as you at its time.
          </DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing scheduled here.
          </p>
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            {rows.map((row) =>
              editing === row.id ? (
                <ScheduledEditRow
                  key={row.id}
                  row={row}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <ScheduledRow
                  key={row.id}
                  row={row}
                  now={now}
                  onEdit={() => setEditing(row.id)}
                />
              ),
            )}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduledRow({
  row,
  now,
  onEdit,
}: {
  row: ScheduledMessage;
  now: Date;
  onEdit: () => void;
}) {
  const { toast } = useToast();
  const sendNow = useSendScheduledMessageNow();
  const remove = useDeleteScheduledMessage();
  const busy = sendNow.isPending || remove.isPending;
  const failed = row.status === "failed";
  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      data-scheduled-row={row.status}
    >
      <p
        className={
          failed
            ? "text-caption text-destructive"
            : "text-caption text-muted-foreground"
        }
      >
        {failed
          ? scheduledFailureCopy(row.failure_reason)
          : formatScheduledFor(new Date(row.send_at), now)}
      </p>
      {row.content.trim() ? (
        <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm">
          {row.content}
        </p>
      ) : null}
      <ScheduledExtras row={row} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onEdit}
          disabled={busy}
        >
          Edit
        </Button>
        {failed ? null : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              sendNow.mutate(row.id, {
                onSuccess: () => toast({ title: "Message sent" }),
                onError: (error) =>
                  toast({
                    title: "Couldn't send it",
                    description: errorCopy(error),
                    variant: "destructive",
                  }),
              })
            }
          >
            Send now
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            remove.mutate(row.id, {
              onError: (error) =>
                toast({
                  title: "Couldn't delete it",
                  description: errorCopy(error),
                  variant: "destructive",
                }),
            })
          }
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

/** "Reply · 2 photos" under the text, naming the files (#4971). */
function ScheduledExtras({ row }: { row: ScheduledMessage }) {
  const extras = scheduledMessageExtras(row);
  if (!extras) return null;
  const names = row.attachments.map((file) => file.filename).join(", ");
  return (
    <p
      className="flex items-center gap-1.5 text-caption text-muted-foreground"
      data-scheduled-extras=""
      title={names || undefined}
    >
      {row.attachments.length > 0 ? (
        <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <CornerUpLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate">
        {extras}
        {names ? <span className="sr-only">: {names}</span> : null}
      </span>
    </p>
  );
}

function ScheduledEditRow({
  row,
  onDone,
}: {
  row: ScheduledMessage;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateScheduledMessage();
  const failed = row.status === "failed";
  // A failed message's time has passed: its fields start empty, and left
  // empty it goes at once (the API's next sweep).
  const parts = failed
    ? { date: "", time: "" }
    : localParts(new Date(row.send_at));
  const [content, setContent] = useState(row.content);
  const [date, setDate] = useState(parts.date);
  const [time, setTime] = useState(parts.time);
  const sendAtOnce = failed && !date && !time;
  const at = fromLocalParts(date, time);
  const problem = sendAtOnce ? null : scheduleTimeProblem(at, new Date());
  const timeChanged = date !== parts.date || time !== parts.time;
  // Files go with or without text; the text is all a text message has.
  const empty = content.trim() === "" && row.attachments.length === 0;
  return (
    <li className="rounded-md border border-border p-3">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (problem || empty) return;
          const changedText = content !== row.content;
          update.mutate(
            {
              id: row.id,
              // The `@` picks the new text still writes (#3835), so a typo
              // fix keeps its mentions reaching the members picked.
              ...(changedText
                ? {
                    content,
                    mentionPicks: mentionPicksIn(
                      content,
                      row.mention_picks ?? [],
                    ),
                  }
                : {}),
              ...(timeChanged && !sendAtOnce ? { sendAt: at } : {}),
            },
            {
              onSuccess: onDone,
              onError: (error) =>
                toast({
                  title: "Couldn't save it",
                  description: errorCopy(error),
                  variant: "destructive",
                }),
            },
          );
        }}
      >
        <Label htmlFor={`scheduled-${row.id}`} className="sr-only">
          Message
        </Label>
        <Textarea
          id={`scheduled-${row.id}`}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
        />
        <ScheduledExtras row={row} />
        <ScheduleTimeFields
          date={date}
          time={time}
          onDate={setDate}
          onTime={setTime}
          problem={problem}
        />
        {failed ? (
          <p className="text-caption text-muted-foreground">
            Leave the time empty to send it as soon as you save.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onDone}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={update.isPending || problem !== null || empty}
          >
            Save
          </Button>
        </div>
      </form>
    </li>
  );
}
