"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/** `items` with the entry at `from` moved to `to`; the input is not changed. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length
  ) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

type ReorderListProps<T> = {
  items: readonly T[];
  getId: (item: T) => string;
  /** The row's name, for the handle's label and the move announcement. */
  getLabel: (item: T) => string;
  /** The whole list in its new order. */
  onReorder: (items: T[]) => void;
  /** Draws the row beside its handle. */
  renderItem: (item: T, index: number) => ReactNode;
  /**
   * No handles: the list is read-only. Not for a save in flight, since taking
   * the handles away mid-reorder drops the keyboard's focus and shifts the
   * row's other buttons under a finger.
   */
  disabled?: boolean;
  "aria-label": string;
  className?: string;
};

/**
 * A list whose rows the reader puts in order: the chapter's pledge classes,
 * and the members of one class (#3939).
 *
 * Three ways to move a row, because drag alone leaves out the keyboard and a
 * finger. The grip drags with a mouse. Focused, the grip takes the Up and Down
 * arrow keys. Under a coarse pointer, where HTML drag never starts, each row
 * also shows Move up and Move down. Every move is announced through a polite
 * live region as "Alpha, 2 of 5".
 *
 * The grip is a `div` with the button role, not a `<button>`: Firefox starts
 * no drag from a button. Focus follows a moved row, because React re-inserts
 * the row's DOM node on some moves, which blurs whatever it held.
 *
 * The list only reports the new order; saving it is the caller's.
 */
export function ReorderList<T>({
  items,
  getId,
  getLabel,
  onReorder,
  renderItem,
  disabled = false,
  "aria-label": ariaLabel,
  className,
}: ReorderListProps<T>) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  // Which control to put focus back on once the moved row has been redrawn.
  const refocus = useRef<{ id: string; control: string } | null>(null);
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const row = Array.from(listRef.current?.children ?? []).find(
      (child) => child.getAttribute("data-reorder-id") === target.id,
    );
    const control = row?.querySelector<HTMLElement>(
      `[data-reorder-control="${target.control}"]`,
    );
    // A touch button at the end of the list is disabled, so focus goes to its
    // pair (the grip is hidden under a coarse pointer and can't take it).
    const pair = { up: "down", down: "up" }[target.control];
    const usable =
      control && !(control as HTMLButtonElement).disabled
        ? control
        : row?.querySelector<HTMLElement>(
            `[data-reorder-control="${pair ?? "grip"}"]`,
          );
    usable?.focus();
  }, [items]);

  function move(from: number, to: number, control?: string) {
    if (to < 0 || to >= items.length || from === to) return;
    const item = items[from];
    if (item === undefined) return;
    if (control) refocus.current = { id: getId(item), control };
    onReorder(moveItem(items, from, to));
    setAnnouncement(`${getLabel(item)}, ${to + 1} of ${items.length}`);
  }

  function endDrag() {
    setDraggingId(null);
    setOverId(null);
  }

  return (
    <>
      <ol
        ref={listRef}
        aria-label={ariaLabel}
        className={cn("space-y-2", className)}
      >
        {items.map((item, index) => {
          const id = getId(item);
          const label = getLabel(item);
          return (
            <li
              key={id}
              data-reorder-id={id}
              onDragOver={(event) => {
                if (draggingId === null) return;
                // Without this the browser refuses the drop.
                event.preventDefault();
                if (overId !== id) setOverId(id);
              }}
              onDrop={(event) => {
                if (draggingId === null) return;
                event.preventDefault();
                const from = items.findIndex(
                  (entry) => getId(entry) === draggingId,
                );
                endDrag();
                move(from, index);
              }}
              className={cn(
                "flex items-center gap-2 rounded-md border border-border p-2",
                draggingId === id && "opacity-50",
                overId === id && draggingId !== id && "border-accent-text",
              )}
            >
              {disabled ? null : (
                <div
                  role="button"
                  tabIndex={0}
                  draggable
                  data-reorder-control="grip"
                  aria-label={`Reorder ${label}`}
                  title="Drag to reorder, or use the arrow keys"
                  onDragStart={(event) => {
                    setDraggingId(id);
                    event.dataTransfer.effectAllowed = "move";
                    // Firefox starts no drag without data.
                    event.dataTransfer.setData("text/plain", id);
                    const row = event.currentTarget.closest("li");
                    if (row) event.dataTransfer.setDragImage(row, 16, 16);
                  }}
                  onDragEnd={endDrag}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      move(index, index - 1, "grip");
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      move(index, index + 1, "grip");
                    }
                  }}
                  className={cn(
                    "flex h-9 w-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:text-foreground active:cursor-grabbing pointer-coarse:hidden",
                    FOCUS_RING,
                  )}
                >
                  <GripVertical className="h-4 w-4" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
              {disabled ? null : (
                <div className="hidden shrink-0 pointer-coarse:flex">
                  <IconButton
                    label={`Move ${label} up`}
                    data-reorder-control="up"
                    disabled={index === 0}
                    onClick={() => move(index, index - 1, "up")}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={`Move ${label} down`}
                    data-reorder-control="down"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, index + 1, "down")}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </IconButton>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
