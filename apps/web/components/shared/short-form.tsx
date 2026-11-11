"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

/**
 * Where a short form is drawn (`spec/ui/design-system/components.md` § Surface
 * size). One form body serves both, so a field or a rule lives in one place:
 *
 * - `dialog`: the centred Dialog (the Service and Points pages), controls at
 *   the Field step (40 to a mouse) and Cancel beside the primary.
 * - `card`: inside the chat composer's + card (#3983), 360px wide, controls at
 *   the Small step (36 to a mouse, 44 to a finger), and a Discard draft icon
 *   in place of Cancel, since closing the card keeps the draft.
 */
export type FormLayout = "dialog" | "card";

/** The Small step for a field in the card; the Field step's own class otherwise. */
export function fieldClass(layout: FormLayout): string | undefined {
  return layout === "card" ? "h-9" : undefined;
}

/** An inline message under a field: what's missing or wrong, never a toast. */
export function FieldError({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} role="alert" className="text-caption text-destructive-text">
      {children}
    </p>
  );
}

export function FormFooter({
  layout,
  onCancel,
  cancelDisabled,
  start,
  children,
}: {
  layout: FormLayout;
  /** Cancel in a dialog; Discard draft in the card. */
  onCancel: () => void;
  cancelDisabled?: boolean;
  /** A control before the primary, left of it (the card's More options). */
  start?: ReactNode;
  /** The primary action. */
  children: ReactNode;
}) {
  if (layout === "card") {
    return (
      <div className="flex items-center gap-1 pt-1">
        <IconButton
          label="Discard draft"
          onClick={onCancel}
          disabled={cancelDisabled}
          className="shrink-0"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        {start}
        <div className="ml-auto">{children}</div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      )}
    >
      {start}
      {/* Not gated: it only closes, and a lapsed chapter needs a way out. */}
      <Button
        type="button"
        variant="secondary"
        onClick={onCancel}
        disabled={cancelDisabled}
      >
        Cancel
      </Button>
      {children}
    </div>
  );
}

/** The primary's size: the Small step in the card. */
export function primarySize(layout: FormLayout): "sm" | "default" {
  return layout === "card" ? "sm" : "default";
}

/**
 * Report a form's draft to its host after each edit, never on mount, so the
 * + card can keep it when the card closes and hand it back when the form
 * opens again (#3983). The form still owns its state while it is open.
 */
export function useReportDraft<T>(
  draft: T,
  onDraftChange: ((draft: T) => void) | undefined,
): void {
  const first = useRef(true);
  const report = useRef(onDraftChange);
  useEffect(() => {
    report.current = onDraftChange;
  });
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    report.current?.(draft);
  }, [draft]);
}
