import * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Tables are not drawn in the reference, so this composes from the tokens
 * `spec/ui/design-system/components.md` §2 requires of undrawn primitives.
 *
 * Three scaffold values did not survive the move to Signet: `font-medium` on
 * the header and footer (500 is not one of the three weights Figtree ships —
 * foundations.md §7 locks 400/600/700, so 500 was being synthesised), the
 * `bg-secondary` footer (the card step, i.e. the same colour as the card a
 * table usually sits in), and `hover:bg-accent/50` for the row hover, which
 * half-mixed the elevated step into the row underneath it.
 *
 * Two of those three are footer facts, and this file no longer ships a footer:
 * `TableFooter` and `TableCaption` were deleted as unimported. They are kept in
 * the record here because a later slice that needs a totals row must re-derive
 * both corrections rather than paste shadcn's stock `<tfoot className="border-t
 * bg-muted/50 font-medium">`, which reships exactly the two defects above.
 *
 * ── Row states ────────────────────────────────────────────────────────────
 *
 * The full `hover:bg-accent` that replaced that half-mix had the same defect at
 * full strength: `--accent` held the same value as `--popover` (the alias is
 * deleted, #3036), so a row on a `--card` surface hovered at **1.085:1** on
 * the ladder of the time (1.105:1 today), no feedback at all. The accent tint that replaced it separated by hue, not
 * luminance, and painted every hovered row in the chapter color.
 *
 * Since 2026-11-05 both states are neutral (`foundations.md` §6, "Where the
 * accent goes"): a row is not a control the member switched on, so it does not
 * take the accent.
 *
 *   hover      `--card-hover`, the step above the whole ladder: 1.324:1 on
 *              `--card`, where the ladder's own next step is 1.105:1.
 *   selected   `--popover` with `--foreground` text, one step under hover,
 *              so a ghost or secondary button inside a selected row still
 *              lifts when hovered.
 *
 * Neither fill is what says a row is selected. Hover is a pointer-only
 * convenience already redundant with the cursor, and no neutral fill clears
 * README.md §6's 3:1 non-text floor, so a fill was never what told a member a
 * row is selected. **Selection carries information**, and every table that
 * offers it says so twice without a fill: the checked checkbox in the row (the
 * accent, because it is a control the member switched on) and the "N selected"
 * bar above the table. `data-[state=selected]:hover:` keeps a hovered selected
 * row on the hover fill: `hover:` and `data-[state=selected]:` are one
 * condition each at the same specificity, so Tailwind breaks the tie by its
 * own variant sort order, and two conditions win it deterministically. Pinned in
 * `components/shared/table-contrast.spec.ts`.
 *
 * Cell text is `body` (16). A table on the 375px floor scrolls inside its own
 * container rather than shrinking its type below the §7 floor.
 */
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-base", className)}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("[&_tr]:border-b [&_tr]:border-border", className)}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
));
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-border transition-colors",
      "hover:bg-card-hover",
      "data-[state=selected]:bg-popover data-[state=selected]:text-foreground",
      "data-[state=selected]:hover:bg-card-hover",
      className,
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-11 px-2 text-left align-middle text-sm font-semibold text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell };
