import * as React from "react"

import { cn } from "@/lib/utils"

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
 * ── Row states, and why they are three classes rather than one ──────────────
 *
 * The full `hover:bg-accent` that replaced that half-mix had the same defect at
 * full strength: `--accent` holds the same value as `--popover`, so a row on a
 * `--card` surface hovered at **1.085:1** — no feedback at all. §2's remedy is
 * the accent tint, and the trap is that the tint does not fix it *by luminance*:
 * `--accent-subtle` measures 1.032–1.143:1 on `--card` across the 19 seeded
 * chapter colours, which straddles the neutral step it replaces rather than
 * beating it — **13 of the 19 seeds land at or below 1.085**, the four dark reds
 * worst at 1.032, and the best of them reaches only 1.143. So luminance
 * separation is not something the tint can be relied on to provide at all. What
 * it does buy is **hue** — its channel spread from `--card` is 7–86 against the
 * neutral step's 3, and that holds for every seed including the achromatic
 * three.
 *
 * So the two states are separated from each other, and from the base row, by
 * three different mechanisms rather than one:
 *
 *   hover      accent-3 — the hue shift §2 specifies
 *   selected   accent-4 (`--accent-subtle-hover`), which is a real step: 1.178–
 *              1.358:1 on `--card` and 1.108–1.193:1 above the hover fill, for
 *              every seed. §3's own state table takes the same one-step lift.
 *   selected   `--accent-text` on that fill measures 6.33–8.68:1 for every seed
 *              — the load-bearing half, the way focus.ts documents the border
 *              swap as the load-bearing half of the focus ring.
 *
 * `data-[state=selected]:hover:` is not redundant with the two rules above it.
 * `hover:` and `data-[state=selected]:` are both one condition at the same
 * specificity, so Tailwind breaks the tie by its own variant sort order, not by
 * the order they appear here — the trap focus.ts documents and slice 2 hit four
 * times. Two conditions win it deterministically, so a hovered selected row
 * keeps its selected fill.
 *
 * The honest limitation: none of these fills clears README.md §6's 3:1 non-text
 * floor, and at this ladder none can — §2 concedes as much. Hover is a
 * pointer-only convenience already redundant with the cursor. **Selection
 * carries information**, so it is deliberately redundant three ways: this fill,
 * the accent text tone, and — on every table that offers selection — the
 * checked checkbox in the row and the bulk-action bar above it. Pinned in
 * `components/shared/table-contrast.test.ts`.
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
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("[&_tr]:border-b [&_tr]:border-border", className)}
    {...props}
  />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-border transition-colors",
      "hover:bg-accent-subtle",
      "data-[state=selected]:bg-accent-subtle-hover data-[state=selected]:text-accent-text",
      "data-[state=selected]:hover:bg-accent-subtle-hover",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-11 px-2 text-left align-middle text-sm font-semibold text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

export {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
}
