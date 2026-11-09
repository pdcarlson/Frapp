"use client";

import { useId, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CUSTOM_STATUS_MAX,
  DEFAULT_LINE_DURATION,
  LINE_DURATIONS,
  codePointLength,
  lineEndsAt,
  lineProblem,
  type LineDuration,
} from "@repo/hooks/member-status";
import { useSaveOwnStatus } from "@/lib/realtime/use-own-status";
import { cn } from "@/lib/utils";

/**
 * "Clear after", in the order #3845 picked, Today the default. Keys are the
 * Select's string values; "never" stands for "Don't clear" (`null`), since a
 * Radix Select item can't carry an empty value.
 */
const CLEAR_AFTER: { value: string; label: string; duration: LineDuration }[] =
  LINE_DURATIONS.map(({ duration, label }) => ({
    value: duration ?? "never",
    label,
    duration,
  }));

const DEFAULT_CLEAR_AFTER =
  CLEAR_AFTER.find((option) => option.duration === DEFAULT_LINE_DURATION)!
    .value;

/**
 * Set, change or clear the member's custom status line (#3845): one line, at
 * most 80 characters, with "Clear after". Opened from the account menu's
 * custom-status row. Discord and Slack both put this in a small dialog of its
 * own rather than inline in the menu, because a text field inside a menu
 * fights the menu's own typeahead and arrow keys.
 *
 * Mounted only while open (the caller renders it conditionally), so every
 * opening starts from the stored line and the default "Clear after".
 */
export function CustomStatusDialog({
  current,
  onClose,
}: {
  /** The line the member has now, or `null`. */
  current: string | null;
  onClose: () => void;
}) {
  const inputId = useId();
  const helpId = useId();
  const clearAfterId = useId();
  const [draft, setDraft] = useState(current ?? "");
  const [clearAfter, setClearAfter] = useState(DEFAULT_CLEAR_AFTER);
  const { save, isSaving } = useSaveOwnStatus();

  const problem = lineProblem(draft, CUSTOM_STATUS_MAX);
  const trimmed = draft.trim();
  const count = codePointLength(trimmed);

  async function handleSave() {
    if (problem || isSaving) return;
    if (trimmed.length === 0) {
      await handleClear();
      return;
    }
    // Not `?? DEFAULT_LINE_DURATION`: "Don't clear" *is* `null`, and `??`
    // would turn it back into Today.
    const option = CLEAR_AFTER.find((o) => o.value === clearAfter);
    const duration = option ? option.duration : DEFAULT_LINE_DURATION;
    const saved = await save({
      custom_status: trimmed,
      custom_status_expires_at: lineEndsAt(duration, new Date()),
    });
    if (saved) onClose();
  }

  async function handleClear() {
    // A null line clears its end time with it (the API pairs them).
    const saved = await save({ custom_status: null });
    if (saved) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-[420px]">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <DialogHeader>
            <DialogTitle>Set a custom status</DialogTitle>
            <DialogDescription>
              Shows under your name in the Directory and in chat, until it
              clears. Hidden while you&apos;re invisible.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>Status</Label>
            <Input
              id={inputId}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="At practice till 6"
              autoComplete="off"
              aria-invalid={problem ? true : undefined}
              aria-describedby={helpId}
            />
            <p
              id={helpId}
              className={cn(
                "flex justify-between gap-2 text-caption",
                problem ? "text-destructive-text" : "text-muted-foreground",
              )}
            >
              <span>{problem ?? " "}</span>
              <span className="tabular-nums">
                {count}/{CUSTOM_STATUS_MAX}
              </span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={clearAfterId}>Clear after</Label>
            <Select value={clearAfter} onValueChange={setClearAfter}>
              <SelectTrigger id={clearAfterId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLEAR_AFTER.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {current ? (
              <Button
                type="button"
                variant="ghost"
                className="sm:mr-auto"
                disabled={isSaving}
                onClick={() => void handleClear()}
              >
                Clear status
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={Boolean(problem) || isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
