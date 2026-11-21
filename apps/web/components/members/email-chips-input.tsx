"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { isInviteEmail, splitAddresses } from "@repo/validation";
import { cn } from "@/lib/utils";
import { FOCUS_RING_WITHIN } from "@/components/ui/focus";

/**
 * An address the field holds as a chip. `problem` is why it can't be sent
 * yet: it isn't an address, or the last send couldn't email it.
 */
export type EmailChip = { value: string; problem?: "invalid" | "undelivered" };

/** What ends an address while typing: Enter, Tab, comma, semicolon, space. */
const SEPARATOR_KEYS = new Set(["Enter", "Tab", ",", ";", " "]);

/**
 * Adds `values` to `chips`, skipping addresses already there
 * (case-insensitively, as the server de-dupes) and marking any that aren't
 * addresses. Pure, for the spec.
 */
export function addChips(chips: EmailChip[], values: string[]): EmailChip[] {
  const seen = new Set(chips.map((chip) => chip.value.toLowerCase()));
  const next = [...chips];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(isInviteEmail(value) ? { value } : { value, problem: "invalid" });
  }
  return next;
}

/**
 * The To field of the invite composer: type or paste addresses and each one
 * becomes a chip, the way a mail client's To line works. A typed address
 * becomes a chip on Enter, Tab, comma, semicolon, space or leaving the field;
 * a paste splits on any of those. Backspace in an empty field takes the last
 * chip back into the text so it can be fixed.
 *
 * Validation happens when an address becomes a chip, never per keystroke
 * (Paul, 2026-11-06): a chip that isn't an address turns red and the caller
 * says why under the field.
 */
export function EmailChipsInput({
  id,
  chips,
  onChipsChange,
  draft,
  onDraftChange,
  placeholder,
  disabled,
  describedBy,
}: {
  id: string;
  chips: EmailChip[];
  onChipsChange: (chips: EmailChip[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  placeholder: string;
  disabled?: boolean;
  /** Id of the line under the field that explains a red chip. */
  describedBy?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasProblem = chips.some((chip) => chip.problem);

  function commit(text: string) {
    const values = splitAddresses(text);
    if (values.length > 0) onChipsChange(addChips(chips, values));
    onDraftChange("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (SEPARATOR_KEYS.has(event.key) && draft.trim() !== "") {
      // Tab with text commits and stays, so the address isn't lost to focus
      // moving on; Tab on an empty field moves focus as usual.
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && chips.length > 0) {
      event.preventDefault();
      const last = chips[chips.length - 1];
      onChipsChange(chips.slice(0, -1));
      onDraftChange(last?.value ?? "");
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!/[\s,;]/.test(text.trim())) return; // one address: let it paste
    event.preventDefault();
    // The paste replaces any selected text, as it would in a plain field.
    const input = event.currentTarget;
    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? draft.length;
    commit(`${draft.slice(0, start)} ${text} ${draft.slice(end)}`);
  }

  function remove(index: number) {
    onChipsChange(chips.filter((_, i) => i !== index));
    inputRef.current?.focus();
  }

  return (
    // Clicking the field's padding focuses the text input, as a native field
    // would. Not a control itself: the input inside is.
    <div
      onClick={() => inputRef.current?.focus()}
      className={cn(
        // The §4 field recipe (fill, hairline, radius, focus), grown to hold
        // chips: a minimum of the field height, wrapping as chips are added.
        "flex min-h-10 w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-control-edge bg-surface-1 px-2 py-1.5 pointer-coarse:min-h-11",
        FOCUS_RING_WITHIN,
        hasProblem && "border-destructive",
        disabled && "cursor-not-allowed border-border",
      )}
    >
      {chips.map((chip, index) => (
        <span
          key={chip.value.toLowerCase()}
          className={cn(
            // §5's Chip step: 24 tall, radius 8, padding-x 8, 12.5 / 600.
            "inline-flex h-6 max-w-full items-center gap-1 rounded-[8px] pl-2 pr-1 text-caption font-semibold",
            chip.problem
              ? "bg-destructive-tint text-destructive-text"
              : "bg-card text-foreground",
          )}
        >
          <span className="truncate">{chip.value}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              remove(index);
            }}
            aria-label={`Remove ${chip.value}`}
            className="grid h-4 w-4 place-items-center rounded-[4px] text-muted-foreground hover:bg-card-hover hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        // Text with an email keyboard, not type="email": that type hides the
        // selection from script, which the paste above needs.
        type="text"
        inputMode="email"
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        disabled={disabled}
        placeholder={chips.length === 0 ? placeholder : undefined}
        aria-invalid={hasProblem || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => {
          if (draft.trim() !== "") commit(draft);
        }}
        className="h-7 min-w-[6rem] flex-1 bg-transparent px-1 text-base text-foreground caret-primary outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}
