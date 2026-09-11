"use client";

import * as React from "react";
import { formatBytes } from "@repo/formatting";
import { DocumentsGlyph } from "@/components/layout/nav-glyphs";
import { DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FOCUS_RING_OFFSET_WITHIN } from "@/components/ui/focus";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The upload sheet chrome, transcribed from framework board option `1j`
 * ("Backwork upload · dialog chrome only"), which is rank 1 in
 * `spec/ui/web-greenfield/README.md` §1 while #2140 is open.
 *
 * The board's note on that option is the whole specification:
 *
 * > r20 sheet on the popover step, 44px fields so they read one level below.
 * > Errors inline on touched fields; Upload stays enabled. Drop zone collapses
 * > to a file row once a file is chosen. No instructional paragraph.
 *
 * Two consumers, `/documents` and `/backwork`, which is why this is a module
 * rather than a recipe copied into both. They previously carried two spellings
 * of the same dialog, and the pair had already drifted — one capped its body
 * height and scrolled, the other did not.
 *
 * **What this is not.** It is chrome only, in the sense the board's own label
 * says. The signed-URL request, the wire field names and the storage path are
 * [#2129](https://github.com/pdcarlson/Frapp/issues/2129) and are untouched
 * here; every call site still owns its own `handleUpload`.
 *
 * **Nothing here defines a token.** The board's `#2A2621` sheet is
 * `bg-popover`, its `#1A1A1A` field is `bg-surface-1`, its `#F85149` error
 * border is `border-destructive` and its `#FF7B72` error text is
 * `text-destructive-text`. The one place the board's raw value is *not* taken
 * is the file well's `rgba(255,255,255,.2)` dashed hairline, which is
 * `border-input` (`.14`) instead: `components.md` §2's "a hairline's alpha is
 * not a free parameter" outranks a third alpha invented for one border.
 */

/**
 * A field inside the sheet, at the board's 44px.
 *
 * `Input`, `Textarea` and `SelectTrigger` all ship §4's 48px default, which is
 * right for a form on a page and one step too tall for a sheet — the board
 * pitches sheet fields "one level below" deliberately, so the sheet reads as
 * secondary to the surface it sits over. Radius, fill, hairline and focus are
 * already the board's values on those primitives and are not respelled here.
 *
 * `Textarea` is `min-h-24` rather than a fixed height, so this is the wrong
 * class for one — pass `rows` instead and leave its height alone.
 */
export const UPLOAD_FIELD_CLASS = "h-11";

/**
 * The sheet's own buttons, at the board's 44px / r12 / 15px.
 *
 * Not `size="sm"`: that is 44px too, but it also drops the label to `text-sm`,
 * and the board draws the footer at 15px. Spelling the height here rather than
 * adding a `size` variant keeps the change inside this lane.
 */
export const UPLOAD_SHEET_BUTTON_CLASS = "h-11 px-4 text-[15px]";

/**
 * The sheet container.
 *
 * `p-0` and `gap-0`: `DialogContent`'s own `p-6`/`gap-4` is the page-dialog
 * rhythm, and the board gives the sheet three bands with different insets — a
 * 56px title row at `0 12px 0 20px`, a body at `4px 20px 20px`, and a footer
 * that sits at the body's inset. The bands carry their own padding below, so
 * the container carries none.
 *
 * The 56px title row is also what puts `DialogContent`'s built-in close button
 * where the board draws it: that control is a 24px box pinned at `top-4`, so
 * its centre lands at 28px, which is the centre of a 56px row.
 *
 * **`aria-describedby={undefined}` is load-bearing, not a tidy-up.** The board
 * deletes the instructional paragraph, so there is no `DialogDescription` to
 * point at, and Radix warns on every open for a `Content` that references a
 * description id nothing renders. Every constraint that paragraph used to
 * carry is now field help inside `UploadFileField`, where it describes the
 * control it constrains instead of the dialog as a whole.
 */
export const UploadSheetContent = React.forwardRef<
  React.ElementRef<typeof DialogContent>,
  React.ComponentPropsWithoutRef<typeof DialogContent>
>(({ className, ...props }, ref) => (
  <DialogContent
    ref={ref}
    aria-describedby={undefined}
    className={cn(
      "max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-[520px]",
      className,
    )}
    {...props}
  />
));
UploadSheetContent.displayName = "UploadSheetContent";

/**
 * The 56px title row. 18/700 is the board's "Sheet title" role from its token
 * sheet (`3a`), one step under the 28/700 page title and one over the top
 * bar's 15/700.
 *
 * `pr-14` clears the close button rather than letting a long title run under
 * it.
 */
export function UploadSheetTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center pl-5 pr-14">
      <DialogTitle className={cn("truncate text-lg font-bold", className)}>
        {children}
      </DialogTitle>
    </div>
  );
}

/**
 * The sheet body: the `<form>` itself, so the fields inside it submit.
 *
 * Scrolls rather than growing past the viewport. `/backwork` capped its dialog
 * at `max-h-[80vh]` and `/documents` did not, which is the drift a shared
 * module exists to end — and the cap belongs on the scrolling band, not on the
 * container, or the footer scrolls away with the fields.
 */
export function UploadSheetBody({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"form">) {
  return (
    <form
      className={cn(
        "flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5 pt-1",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The footer. Sits at the body's inset, right-aligned, and is outside the
 * scrolling band so Cancel and Upload stay reachable on a long form.
 *
 * Not `DialogFooter`: that one stacks `flex-col-reverse` below `sm`, which put
 * the primary action at the top of a phone-width sheet. The board draws one
 * row at every width.
 */
export function UploadSheetFooter({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 px-5 pb-5",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Label, control, and the inline error under it.
 *
 * The board draws the error as 12.5px `#FF7B72` directly beneath the field,
 * with the field's own hairline swapping to `#F85149` — no icon, no filled
 * red block. The border half is the caller's, because it belongs on the
 * control element: spread {@link fieldErrorProps} onto it, which also carries
 * the `aria-invalid` and `aria-describedby` that make the error reachable to a
 * screen reader rather than merely visible.
 *
 * `role="alert"` rather than a live region on the form: these errors appear on
 * submit and on change of the field they describe, so they are announced when
 * they land and there is nothing to poll.
 */
export function UploadField({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  /** Rendered when set. Nothing is reserved for it when it is not. */
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  /*
    `content-start`, and it is not cosmetic tidying. These sit in a
    `sm:grid-cols-2` row, so a cell whose sibling has an error is the taller of
    the two; without this the shorter cell's rows stretch to match and its
    input floats ~10px below its neighbour's, so one form row renders at two
    baselines the moment anything goes wrong. Caught on screen, not in a test.
  */
  return (
    <div className={cn("grid content-start gap-1", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p
          id={fieldErrorId(id)}
          role="alert"
          className="text-[12.5px] text-destructive-text"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function fieldErrorId(id: string): string {
  return `${id}-error`;
}

/**
 * The control half of {@link UploadField}'s error state: the hairline swap and
 * the two ARIA attributes, spelled once so a field cannot ship the red border
 * without the announcement or the other way round.
 *
 * `aria-invalid` is written as a string because that is what the attribute
 * takes; React renders the boolean form correctly too, but a `false` becomes
 * `aria-invalid="false"` rather than being dropped, which is a different claim
 * from saying nothing.
 */
export function fieldErrorProps(id: string, error?: string | null) {
  return error
    ? ({
        "aria-invalid": "true",
        "aria-describedby": fieldErrorId(id),
        className: "border-destructive",
      } as const)
    : ({} as const);
}

function fileExtensionLabel(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1);
  // A "extension" long enough to be a sentence is a filename with a full stop
  // in it, not a type. "Minutes. Final draft.pdf" reads its real one either way.
  if (extension.length > 8) return null;
  return extension.toUpperCase();
}

/**
 * The file field: a well that collapses to a file row once a file is chosen.
 *
 * Both states are the board's `1j` well — r14, a dashed hairline, on the card
 * step — so choosing a file changes what the well says rather than replacing
 * one control with another and shifting every field below it.
 *
 * **It is not a drop target and does not look like one.** The board labels this
 * a "drop zone", but drag-and-drop is behavior and this lane is chrome, so what
 * ships is the well and its file row without a drop handler. Styling it as a
 * target that silently ignores a drop would be the worse half of the board to
 * take.
 *
 * **The hint is field help, not the paragraph the board deletes.** `1j` says
 * "no instructional paragraph", which is about the block of prose that used to
 * sit under the title narrating the dialog. The accepted types and the size cap
 * are a constraint on this control, they are 12.5px meta beside it, and a
 * member who cannot see them finds out by having an upload rejected.
 */
export function UploadFileField({
  id,
  label,
  hint,
  file,
  accept,
  error,
  disabled,
  onSelect,
}: {
  id: string;
  label: React.ReactNode;
  /** The accepted types and size cap, as field help. */
  hint: React.ReactNode;
  file: File | null;
  accept: string;
  error?: string | null;
  disabled?: boolean;
  onSelect: (file: File | null) => void;
}) {
  const extension = file ? fileExtensionLabel(file.name) : null;

  /*
    A `<label>` styled as the affordance, over an `sr-only` input.

    The input stays in the accessibility tree and stays focusable, so the
    control is reachable and operable by keyboard exactly as a file input
    normally is; the ring is drawn by the wrapper on `focus-within`, because
    the element that takes focus is the one that is visually hidden.
  */
  const picker = (
    <>
      {/*
        `aria-hidden`, and only on this one. Two `<label for>` elements on one
        control concatenate into its accessible name, so without this the file
        input announces as "File Choose file" — and after a file is picked, as
        "File Replace", which reads like the name of the control changing. The
        field's real label is the `<Label>` below, outside the well.

        Safe to hide: a `<label>` is not focusable, so this is not an
        aria-hidden-focusable defect, and nothing is lost to a screen reader.
        The control it labels is a native file input, which announces itself
        and carries its own activation.
      */}
      <Label
        aria-hidden
        htmlFor={id}
        className={cn(
          "inline-flex h-9 shrink-0 cursor-pointer items-center rounded-md border border-input px-3 text-sm font-semibold text-foreground transition-colors",
          "pointer-coarse:h-11",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        {file ? "Replace" : "Choose file"}
      </Label>
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? fieldErrorId(id) : undefined}
        onChange={(event) => onSelect(event.target.files?.[0] ?? null)}
      />
    </>
  );

  return (
    <div className="grid content-start gap-1">
      {/*
        A real `<label for>`, not a styled `<span>`. It is the field's label in
        the accessibility tree as well as on screen, so the input announces as
        "File" and is reachable by that name — which is also what the suites
        below query it by.
      */}
      <Label htmlFor={id}>{label}</Label>
      <div
        className={cn(
          "rounded-lg border border-dashed bg-card p-4",
          FOCUS_RING_OFFSET_WITHIN,
          error ? "border-destructive" : "border-input",
        )}
      >
        {file ? (
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-accent-subtle text-accent-text"
            >
              <DocumentsGlyph className="h-5 w-5" active />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {file.name}
              </p>
              <p className="text-[12.5px] text-muted">
                {formatBytes(file.size)}
                {extension ? ` · ${extension}` : ""}
              </p>
            </div>
            {picker}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {picker}
            <p className="min-w-0 flex-1 text-[12.5px] text-muted">{hint}</p>
          </div>
        )}
      </div>
      {error ? (
        <p
          id={fieldErrorId(id)}
          role="alert"
          className="text-[12.5px] text-destructive-text"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
