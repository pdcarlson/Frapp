import { cn } from "@/lib/utils";

/**
 * A route's title row, in the main pane.
 *
 * The shell used to derive every page's title from `nav-config` and render it
 * as an `<h1>` inside a breadcrumb block in the header. That block is deleted
 * (board `1t`), and the title moved down here — so a page now names itself
 * rather than being named by the chrome around it.
 *
 * **Placement.** The board puts the title in the top bar's left cell at 15/700
 * and gives a flat route's main pane a bare toolbar row with no heading at all
 * (`1f` pin 2). #2141 says the opposite: "page title lives in the main pane",
 * "titles not in top bar". This component is the resolution that was confirmed
 * for this lane — the title sits at the LEFT of that same toolbar row, with
 * actions still pushed right. That keeps the board's density (one row, no
 * wrapper card, no description paragraph, no divider) while honoring the
 * issue's placement.
 *
 * **It is an `<h1>`, and it is the route's only one.** The old shell `<h1>`
 * duplicated a `CardTitle` or `h2` that most pages already rendered, so
 * "Events" appeared twice on `/events`. A route adopting this component must
 * delete its own copy of the title — one typographic anchor per screen.
 *
 * **Render it on every path the route can take.** The shell used to supply the
 * title from outside, so it covered the loading, offline and error paths for
 * free. It no longer does. A page that mounts this only on its success path
 * loses its heading exactly when the member is most lost.
 *
 * Deliberately a server component: it holds no state and nothing here needs the
 * client bundle.
 */

type PageHeaderProps = {
  title: string;
  /**
   * Trailing controls: filters, a create button, an export menu. They are
   * pushed right on one line with the title and wrap beneath it when the row
   * runs out of width, which is what holds the 375px floor.
   */
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-2",
        className,
      )}
    >
      {/*
        15/700 is the board's in-shell title role. It is not the 28/700 "Page
        title" from the token sheet — every real use of that one is pre-auth or
        the 404, and reaching for it here rebuilds the header block this lane
        deletes.
      */}
      <h1 className="min-w-0 flex-1 truncate text-[15px] font-bold text-foreground">
        {title}
      </h1>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
