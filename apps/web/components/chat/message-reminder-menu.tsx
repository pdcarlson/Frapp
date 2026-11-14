"use client";

import { useState } from "react";
import { localIsoDate } from "@repo/formatting";
// The pure presets, not the hooks barrel: the write is the caller's
// (`onRemind`), so a surface that renders messages needs no new hook.
import {
  MESSAGE_REMINDER_LABEL,
  MESSAGE_REMINDER_PRESETS,
  messageReminderPresetTime,
} from "@repo/hooks/use-message-reminders";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { NavGlyph } from "@/components/layout/nav-glyphs";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACTION_BAR_BUTTON } from "./chip";

/** The custom picker opens on tomorrow at 9:00 AM, the "Tomorrow" preset. */
function defaultCustomEntry(now: Date): string {
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  return `${localIsoDate(tomorrow)}T09:00`;
}

/** `YYYY-MM-DDTHH:MM` in the member's own time zone, or null. */
function entryToDate(entry: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(entry);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as number[];
  const at = new Date(y!, mo! - 1, d!, h!, mi!);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The action bar's "Remind me about this" (#4957): Slack's own menu of that
 * name, its five presets and then Custom…, which opens a date and time
 * picker. The pick goes to `onRemind`; the caller writes it and confirms.
 */
export function MessageReminderMenu({
  onRemind,
}: {
  onRemind: (remindAt: Date) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={ACTION_BAR_BUTTON}
            aria-label={MESSAGE_REMINDER_LABEL}
            title={MESSAGE_REMINDER_LABEL}
          >
            <NavGlyph paths={NAV_GLYPHS.schedule} className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{MESSAGE_REMINDER_LABEL}</DropdownMenuLabel>
          {MESSAGE_REMINDER_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => onRemind(messageReminderPresetTime(preset.id))}
            >
              {preset.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCustomOpen(true)}>
            Custom…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {customOpen ? (
        <CustomReminderDialog
          onClose={() => setCustomOpen(false)}
          onPick={(at) => {
            setCustomOpen(false);
            onRemind(at);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Custom…: the shared date field (type `Friday` or `Nov 20`, or pick from the
 * month; a typed `Fri 5pm` carries its time) and a time beside it.
 */
function CustomReminderDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (at: Date) => void;
}) {
  const [entry, setEntry] = useState(() => defaultCustomEntry(new Date()));
  const [lastTime, setLastTime] = useState("09:00");
  const [error, setError] = useState<string | null>(null);
  const [day = "", typedTime] = entry.split("T");
  const time = typedTime ?? lastTime;

  const submit = () => {
    const at = entryToDate(day && time ? `${day}T${time}` : "");
    if (!at) {
      setError("Pick a day and a time.");
      return;
    }
    if (at.getTime() <= Date.now()) {
      setError("That time has already passed. Pick a later time.");
      return;
    }
    onPick(at);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{MESSAGE_REMINDER_LABEL}</DialogTitle>
            <DialogDescription>
              Pick when to be reminded. Only you see it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="message-reminder-day">Day</Label>
            <DateField
              id="message-reminder-day"
              withTime
              lean="ahead"
              value={entry}
              onChange={(next) => {
                setError(null);
                const [nextDay = "", nextTime] = next.split("T");
                if (nextTime) setLastTime(nextTime);
                setEntry(nextDay ? `${nextDay}T${nextTime ?? time}` : "");
              }}
              error={error}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="message-reminder-time">Time</Label>
            <Input
              id="message-reminder-time"
              type="time"
              value={time}
              onChange={(event) => {
                setError(null);
                const next = event.target.value;
                setLastTime(next);
                if (day) setEntry(`${day}T${next}`);
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Set reminder</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
