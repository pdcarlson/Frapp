"use client";

import { useRef } from "react";
import { acceptAttribute, type UploadKind } from "@repo/validation";
import { Button } from "@/components/ui/button";
import type { FormLayout } from "@/components/shared/short-form";

/**
 * A one-file field: a Choose button, the picked file's name, and Remove. A
 * file input can't be given a file back, so the picked file is shown by name
 * rather than by the browser's own control, which would read "No file chosen"
 * when a kept draft reopens. The service-hours proof field and the task photo
 * fields (#4565) share it; `kind` is the `@repo/validation` upload kind whose
 * types the browser's chooser offers.
 */
export function FilePicker({
  inputRef,
  id,
  kind,
  file,
  invalid,
  layout,
  onPick,
  chooseLabel = "Choose file",
  emptyLabel = "No file chosen",
  testId,
}: {
  /** The Choose button: what the label names and what an error focuses. */
  inputRef?: React.RefObject<HTMLButtonElement | null>;
  id: string;
  kind: UploadKind;
  file: File | null;
  invalid: boolean;
  layout: FormLayout;
  onPick: (file: File | null) => void;
  chooseLabel?: string;
  emptyLabel?: string;
  testId?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const nameId = `${id}-name`;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        ref={fileInput}
        type="file"
        accept={acceptAttribute(kind)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid={testId}
        onChange={(event) => {
          onPick(event.target.files?.[0] ?? null);
          // Let the same file be picked again after Remove.
          event.target.value = "";
        }}
      />
      <Button
        ref={inputRef}
        id={id}
        type="button"
        variant="secondary"
        size={layout === "card" ? "sm" : "default"}
        className="shrink-0 aria-[invalid=true]:border-destructive"
        aria-invalid={invalid || undefined}
        aria-describedby={nameId}
        onClick={() => fileInput.current?.click()}
      >
        {file ? "Change" : chooseLabel}
      </Button>
      <span
        id={nameId}
        className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
      >
        {file ? file.name : emptyLabel}
      </span>
      {file ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          aria-label={`Remove ${file.name}`}
          onClick={() => onPick(null)}
        >
          Remove
        </Button>
      ) : null}
    </div>
  );
}
