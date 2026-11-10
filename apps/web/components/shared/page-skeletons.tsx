import { PageActions } from "@/components/layout/page-actions";
import { Skeleton } from "@/components/shared/async-states";
import { denseListClassName } from "@/components/shared/table-controls";
import { cn } from "@/lib/utils";

/**
 * Page-shaped skeletons: the pieces a route composes into a loading state that
 * mirrors its own loaded layout (`components.md` §10, "the skeleton mirrors
 * the layout it becomes — same blocks, same radii").
 *
 * Before these existed every route fell back to one generic `LoadingState`: a
 * `--card` box with four bars and a caption, drawn on pages that are flush
 * lists on `--background` (README § Page grammar). It matched neither the
 * colour nor the shape of anything it stood in for, so the screen visibly
 * swapped one layout for another when the data landed.
 *
 * The rules these pieces hold:
 *
 * - **Same grammar as the page.** No wrapper card, no border box, no fill the
 *   loaded page does not have. Rows sit in `denseListClassName` exactly as the
 *   loaded rows do; a card skeleton only exists where the loaded page draws a
 *   card (tasks, settings).
 * - **No title.** The route's title lives in the top bar (`page-title.ts`),
 *   which is already up while the body loads, so a skeleton draws none.
 * - **Action placeholders only where the real actions always render.** The
 *   `PageActions` row collapses when empty, and most of its controls sit in a
 *   `<Can>` that draws nothing for members without the permission. A
 *   placeholder for a gated control would draw a row that then vanishes, so
 *   pass `actions` only for controls every member sees.
 * - **Neutral blocks only**, via `Skeleton` (the shared shimmer). Never accent.
 * - **The caption is for assistive tech.** A mirrored skeleton already says
 *   what is loading by its shape; the visible "Loading …" line was there only
 *   because the generic box could not. It stays as one `role="status"` line,
 *   kept apart from the blocks so real content a skeleton renders (Billing's
 *   plan matrix) is not marked busy.
 *
 * A route's skeleton is used twice — by its `loading.tsx` (navigation) and by
 * its first-load branch (the query in flight) — so the two are one component
 * and the hand-off between them does not move a pixel.
 *
 * These are server-safe (no hooks), which is what lets `loading.tsx` use them.
 */

/** The text-line widths `SkeletonText` cycles, reused so rows read as prose. */
const LINE_WIDTHS = ["w-[38%]", "w-[52%]", "w-[30%]", "w-[45%]", "w-[34%]"];
const META_WIDTHS = ["w-[24%]", "w-[31%]", "w-[20%]", "w-[27%]"];

/** Same clamp as `SkeletonText`: decoration, never a runaway loop. */
const MAX_ROWS = 24;

function clampCount(count: number): number {
  return Number.isFinite(count)
    ? Math.min(Math.max(Math.floor(count), 0), MAX_ROWS)
    : MAX_ROWS;
}

/** The one announcement a loading region makes. */
function LoadingStatus({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {label}
    </p>
  );
}

/**
 * The route's loading state: its action row (when every member sees one),
 * then the body skeleton.
 */
export function PageSkeleton({
  label,
  actions,
  className = "space-y-6",
  children,
}: {
  /** Announced to assistive tech: "Loading service hours". */
  label: string;
  /** Placeholders for ungated header controls, usually `SkeletonControl`s. */
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={className}>
      <LoadingStatus label={label} />
      {actions ? <PageActions>{actions}</PageActions> : null}
      {children}
    </div>
  );
}

/**
 * A skeleton that stands in for part of a page — a tab body, a list under a
 * live toolbar — and announces its own load.
 */
export function SectionSkeleton({
  label,
  className = "space-y-6",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <LoadingStatus label={label} />
      {children}
    </div>
  );
}

/**
 * A toolbar-height control: a button, a search field, a select. Height and
 * radius are `Button size="toolbar"`'s and the inputs' (`h-9`, 44 on touch,
 * `rounded-md`); the caller sets the width the real control has.
 */
export function SkeletonControl({ className }: { className?: string }) {
  return (
    <Skeleton className={cn("h-9 rounded-md pointer-coarse:h-11", className)} />
  );
}

/** A `SectionLabel` eyebrow, optionally with its count beside it. */
export function SkeletonSectionLabel({
  width = "w-24",
  count = false,
}: {
  width?: string;
  count?: boolean;
}) {
  return (
    <div className="flex h-4 items-center gap-2">
      <Skeleton className={cn("h-[11px]", width)} />
      {count ? <Skeleton className="h-[11px] w-12" /> : null}
    </div>
  );
}

/** A labelled form field: the label line, then a control. */
export function SkeletonField({
  className,
  control = "h-12",
}: {
  className?: string;
  /** Height class of the control; inputs and selects are 48 by default. */
  control?: string;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Skeleton className="h-[11px] w-20" />
      <Skeleton className={cn("w-full rounded-md", control)} />
    </div>
  );
}

type RowLead = "none" | "avatar" | "checkbox" | "glyph" | "rank";

/**
 * Rows in a dense list, on the loaded list's own hairlines.
 *
 * `lines` is the text stack (title, then meta lines); `trailing` is one width
 * class per trailing block (a badge, a button). Widths cycle rather than
 * randomise so the skeleton is identical across renders and Strict Mode passes.
 */
export function SkeletonRows({
  rows = 5,
  lines = 2,
  lead = "none",
  trailing = [],
  trailingHeight = "h-8",
  rowClassName = "min-h-11 py-2",
  bare = false,
}: {
  rows?: number;
  lines?: 1 | 2 | 3;
  /** One lead block, or several in order (a checkbox, then an avatar). */
  lead?: RowLead | RowLead[];
  trailing?: string[];
  /** Height class of the trailing blocks: `h-8` buttons, `h-5` badges. */
  trailingHeight?: string;
  rowClassName?: string;
  /** Leave out the list hairlines, for rows the loaded page draws without. */
  bare?: boolean;
}) {
  const count = clampCount(rows);
  return (
    <ul aria-hidden="true" className={bare ? undefined : denseListClassName}>
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className={cn("flex items-center gap-3", rowClassName)}>
          {(Array.isArray(lead) ? lead : [lead]).map((block, slot) => (
            <RowLeadBlock key={slot} lead={block} />
          ))}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton
              className={cn(
                "h-[13px]",
                LINE_WIDTHS[index % LINE_WIDTHS.length],
              )}
            />
            {lines >= 2 ? (
              <Skeleton
                className={cn(
                  "h-[11px]",
                  META_WIDTHS[index % META_WIDTHS.length],
                )}
              />
            ) : null}
            {lines >= 3 ? (
              <Skeleton
                className={cn(
                  "h-[11px]",
                  LINE_WIDTHS[(index + 2) % LINE_WIDTHS.length],
                )}
              />
            ) : null}
          </div>
          {trailing.map((width, slot) => (
            <Skeleton
              key={slot}
              className={cn("shrink-0 rounded-md", trailingHeight, width)}
            />
          ))}
        </li>
      ))}
    </ul>
  );
}

function RowLeadBlock({ lead }: { lead: RowLead }) {
  switch (lead) {
    case "avatar":
      return <Skeleton className="h-6 w-6 shrink-0 rounded-full" />;
    case "checkbox":
      // `dashboardTableCheckboxClassName`: 24 square, radius 7.
      return <Skeleton className="h-6 w-6 shrink-0 rounded-[7px]" />;
    case "glyph":
      return <Skeleton className="h-4 w-4 shrink-0 rounded-[4px]" />;
    case "rank":
      return <Skeleton className="h-[13px] w-6 shrink-0" />;
    default:
      return null;
  }
}

/**
 * A framed item, for a page whose loaded items are framed (`/tasks` cards).
 * Same radius and hairline as the real frame, and no
 * fill, because the real frame has none.
 */
export function SkeletonFrame({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-[14px] border border-border", className)}
    >
      {children}
    </div>
  );
}
