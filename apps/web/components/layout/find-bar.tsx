"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useChannels } from "@repo/hooks";
import { cn } from "@/lib/utils";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";
import {
  FindDialog,
  FIND_PLACEHOLDER,
} from "@/components/layout/find-dialog";

/**
 * The top bar's Find entry: a field-shaped button that opens the centered Find
 * dialog (`find-dialog.tsx`), plus the Cmd/Ctrl+F binding that opens it too.
 *
 * **It looks like a field because it is the visible way in.** The shortcut is
 * not advertised (Paul removed the keycap, 2026-11-05), so a member who never
 * presses it still sees where search lives. Clicking it, or typing into it via
 * the shortcut, lands in the dialog's own input.
 *
 * **Taking over Cmd/Ctrl+F is deliberate.** It is the key people already
 * press to find something, and in an app whose content is paginated and
 * virtualized, the browser's own in-page find searches only what happens to
 * be mounted. `components.md` §7 bans a hint for a binding that is NOT wired;
 * an unadvertised binding that is wired breaks nothing.
 *
 * The query lives here, not in the dialog, so closing the dialog (Escape or a
 * click outside) and reopening it keeps what was typed.
 */
export function FindBar({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /*
   * Read here, while the dialog is closed, on purpose. It keeps `["channels"]`
   * warm on every dashboard route, so the dialog's Channels group is instant
   * on the first keystroke, and `use-first-chunk-cache.ts` documents relying
   * on this read having resolved before `/chat` mounts.
   */
  useChannels();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /*
   * Where focus goes back to on close. Radix returns focus to a
   * `Dialog.Trigger`, and this dialog has none (the shortcut opens it from
   * anywhere), so without this focus lands on <body> and the next Tab starts
   * from the top of the document. A shortcut press returns to wherever the
   * member was; a click returns to the field.
   */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Read inside the window listener, which is bound once.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "f") return;
      // `repeat` guard: holding the chord should open once, not re-fire.
      if (event.repeat) return;
      // Already open: the chord means "back to the search text".
      if (openRef.current) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      /*
       * Stand down inside another modal layer, and hand the chord back to the
       * browser. Opening a second modal over a sheet or dialog would stack
       * focus traps, and native find is the more useful of the two in a long
       * form anyway.
       */
      if (document.querySelector("[data-radix-focus-guard]")) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "INPUT")
      ) {
        // Someone is typing somewhere else (the chat composer, a form field).
        // Stealing the caret mid-sentence is worse than not binding at all.
        return;
      }
      event.preventDefault();
      returnFocusRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onOpenChange = useCallback((next: boolean) => setOpen(next), []);
  const restoreFocus = useCallback(() => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    (target?.isConnected ? target : triggerRef.current)?.focus();
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={FIND_PLACEHOLDER}
        onClick={() => {
          returnFocusRef.current = null;
          setOpen(true);
        }}
        className={cn(
          "flex h-[34px] items-center gap-2.5 rounded-[10px] border border-input bg-surface-1 px-3 text-left text-sm text-muted-foreground transition hover:text-foreground",
          FOCUS_RING_SHELL,
          className,
        )}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {query.trim() ? (
            <span className="text-foreground">{query}</span>
          ) : (
            FIND_PLACEHOLDER
          )}
        </span>
      </button>
      <FindDialog
        open={open}
        onOpenChange={onOpenChange}
        query={query}
        onQueryChange={setQuery}
        inputRef={inputRef}
        onCloseFocus={restoreFocus}
      />
    </>
  );
}
