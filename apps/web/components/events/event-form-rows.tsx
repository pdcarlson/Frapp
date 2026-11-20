"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import {
  EVENT_FORM_GLYPHS,
  type EventFormGlyphName,
} from "@repo/theme/event-form-glyphs";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The event form's property rows (#5561, `spec/ui/design-system/components.md`
 * § Property rows): a mark, a quiet label and the value, one row per setting,
 * the way Notion Calendar's event panel and Linear's create form set theirs.
 * The phone draws the same rows (`apps/mobile/components/events/
 * event-form-rows.tsx`) from the same marks and words, so the form reads as
 * one on both.
 */

/** A row's mark, from the marks both apps draw. Decorative. */
export function EventFormGlyph({
  name,
  className,
}: {
  name: EventFormGlyphName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("h-4 w-4 shrink-0", className)}
    >
      {EVENT_FORM_GLYPHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * A run of rows framed on the raised surface, a hairline between each (when
 * and where; who and points; the rest), the way the phone's sheet sets them
 * and Google Calendar's editor groups its fields (#5742), so the form doesn't
 * read as bare text on the page.
 */
export function PropertyGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-md border border-input bg-surface-1 px-2">
      {children}
    </div>
  );
}

/**
 * One row. The label names the control in the value slot (`htmlFor`, or the
 * value's own `aria-label` for a menu trigger). At a docked panel's narrow
 * width the label column narrows and the value keeps the room.
 */
export function PropertyRow({
  glyph,
  label,
  labelFor,
  align = "center",
  children,
  trailing,
}: {
  glyph: EventFormGlyphName;
  label: string;
  /** The id of the input the label names; omitted for a menu trigger. */
  labelFor?: string;
  /** `start` for a row whose value can grow to several lines. */
  align?: "center" | "start";
  children: React.ReactNode;
  /** A quiet control at the row's end (Type's Edit types). */
  trailing?: React.ReactNode;
}) {
  const Label = labelFor ? "label" : "span";
  return (
    <div
      className={cn(
        "grid grid-cols-[1rem_minmax(4.5rem,6.5rem)_minmax(0,1fr)_auto] gap-x-2.5 py-1.5 pl-1",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      <EventFormGlyph
        name={glyph}
        className={cn(
          "text-muted-foreground",
          align === "start" && "mt-2.5",
        )}
      />
      <Label
        {...(labelFor ? { htmlFor: labelFor } : {})}
        className={cn(
          "truncate text-sm text-muted-foreground",
          align === "start" && "mt-2",
        )}
      >
        {label}
      </Label>
      <div className="min-w-0">{children}</div>
      {trailing ? <div className="flex items-center">{trailing}</div> : <span />}
    </div>
  );
}

/**
 * The value as a button that opens its menu: a chip sized to the value's own
 * text with a chevron, the muted tone when nothing is set. Forwarded so a `PopoverTrigger
 * asChild` can hold it.
 */
export const RowValueButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & {
    empty?: boolean;
    invalid?: boolean;
  }
>(function RowValueButton(
  { className, empty, invalid, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        ROW_VALUE,
        QUIET_FIELD,
        "w-fit max-w-full justify-between gap-2 text-left",
        empty ? "text-muted-foreground" : "text-foreground",
        invalid && "text-destructive-text",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-muted-foreground"
      />
    </button>
  );
});

/**
 * The value as a field typed in place: borderless at rest, the card step and
 * the focus ring once it holds the caret.
 */
export const RowInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<"input">
>(function RowInput({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        ROW_VALUE,
        "truncate caret-primary placeholder:text-muted-foreground focus:bg-card",
        "aria-[invalid=true]:text-destructive-text",
        className,
      )}
      {...props}
    />
  );
});

/** A text that grows with what is typed (Description, Notes). */
export const RowTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea">
>(function RowTextarea({ className, onChange, value, ...props }, ref) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null);
  React.useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
  // Grow to the text, so a long description reads whole rather than in a
  // two-line window.
  React.useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={inner}
      rows={1}
      value={value}
      onChange={onChange}
      className={cn(
        ROW_VALUE,
        "h-auto resize-none py-2 leading-5 caret-primary placeholder:text-muted-foreground focus:bg-card",
        className,
      )}
      {...props}
    />
  );
});

/**
 * A value you click to change, drawn as a quiet chip at rest (#5742): the
 * card step on the group's surface, lit on hover, as Linear's issue
 * properties read. Exported for the When row's day and times and the points
 * box, which are the same kind of value.
 */
export const QUIET_FIELD =
  "border border-transparent bg-card hover:bg-card-hover";

/**
 * The Small step (foundations.md §9): 36 to a mouse, 44 to a finger, the
 * label size, and the row's own hover lift.
 */
const ROW_VALUE = cn(
  "flex min-h-9 w-full min-w-0 items-center rounded-md bg-transparent px-2 text-sm pointer-coarse:min-h-11",
  "transition-colors hover:bg-card-hover disabled:pointer-events-none disabled:text-disabled",
  FOCUS_RING,
);
