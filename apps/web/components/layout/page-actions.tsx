import { cn } from "@/lib/utils";

/**
 * A route's action row: filters, a create button, an export menu, pushed to
 * the trailing edge of the main pane.
 *
 * It used to be `PageHeader`, which drew the route's `<h1>` at the left of this
 * same row. The title moved up into the top bar (2026-11-05, `top-bar.tsx`),
 * so a route with no actions renders no row at all and its content starts at
 * the top of the pane, and a route with actions keeps only them.
 *
 * **An empty row collapses** (`empty:hidden`). Most call sites wrap their
 * controls in a `<Can>`, which renders nothing for a role without the
 * permission and while permissions load; without the collapse those members
 * would get a blank 34px band where the title used to be.
 *
 * Deliberately a server component: it holds no state and nothing here needs the
 * client bundle.
 */

type PageActionsProps = {
  children: React.ReactNode;
  className?: string;
};

export function PageActions({ children, className }: PageActionsProps) {
  return (
    /*
      `flex-wrap` is what holds the 375px floor: a segmented control plus a
      button wraps onto a second line inside the row instead of running past
      the screen edge (Points at 390px, 2026-11-05).
    */
    <div
      className={cn(
        "flex min-h-[34px] max-w-full flex-wrap items-center justify-end gap-2 empty:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
