"use client";

import { useMemo, useState } from "react";
import { SearchGlyph } from "@/components/members/directory-glyphs";
import { useAlumni } from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EYEBROW } from "@/components/ui/typography";
import { EmptyState, anyReadUncached } from "@/components/shared/async-states";
// The nested family for everything that replaces the *list*, on the reasoning
// `members-directory.tsx` spells out: the whole-screen variants paint `--card`,
// and this lane just deleted every card on the route. The no-chapter branch
// below is the one exception and says why in place.
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
  NestedOffline,
} from "@/components/shared/nested-states";
import { denseListClassName } from "@/components/shared/table-controls";
import { MemberDetailSheet } from "@/components/members/member-detail-sheet";
import { useNetwork } from "@/lib/providers/network-provider";
import { asArray, cn, initials } from "@/lib/utils";
import { useChapterStore } from "@/lib/stores/chapter-store";

type AlumniRow = {
  id: string;
  user_id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  graduation_year: number | null;
  current_city: string | null;
  current_company: string | null;
  email: string | null;
};

/**
 * The alumni half of the Directory.
 *
 * **Flat, not carded, and the card count is the point.** This screen used to
 * render N + 2 `<Card>`s: a no-chapter guard card, a filter card, and one card
 * per alumnus in a three-column grid. Board `1t` deletes the filter card and
 * the table card one route over, and `1f` pin 2 gives a route's body one
 * toolbar row with "no wrapper card, no description paragraph" — so the filter
 * card's heading survives as the `EYEBROW` section label, its narration
 * paragraph is deleted outright, and the per-alumnus cards become rows in the
 * same flush list the actives half renders.
 *
 * **Rows open the actives' `MemberDetailSheet` (#2484).** They used to be
 * rows of facts with no detail surface, which was harmless while the Actives
 * tab also listed every alumnus. It no longer does, and that sheet is where
 * roles are assigned, so a non-interactive row here would leave an officer no
 * way on web to correct a mistaken Alumni role or remove an alumnus. Mobile's
 * s13 already opens its sheet from both tabs.
 */
export function AlumniDirectory() {
  const { isOffline } = useNetwork();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);

  const [graduationYear, setGraduationYear] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  // The row as it was when opened, not an id looked up in `alumni`: the sheet
  // stays open after a role save, and revoking the Alumni role refetches this
  // list without the member in it — a lookup would empty the sheet mid-edit.
  // The sheet re-reads the member by id itself, so the snapshot only seeds it.
  const [openAlumnus, setOpenAlumnus] = useState<AlumniRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [committed, setCommitted] = useState<{
    graduation_year?: string;
    city?: string;
    company?: string;
  }>({});

  const query = useAlumni({
    graduation_year: committed.graduation_year,
    city: committed.city,
    company: committed.company,
  });

  const alumni = useMemo(() => asArray<AlumniRow>(query.data), [query.data]);
  // A committed filter is the difference between "this chapter has no alumni"
  // and "nothing matched what you asked for" — the two states the board draws
  // separately (`3b`), which this screen used to answer with one string.
  const filtered = Object.values(committed).some(Boolean);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {
      graduation_year: graduationYear.trim() || undefined,
      city: cityFilter.trim() || undefined,
      company: companyFilter.trim() || undefined,
    };
    setCommitted(next);
  }

  function clearFilters() {
    setGraduationYear("");
    setCityFilter("");
    setCompanyFilter("");
    setCommitted({});
  }

  if (!activeChapterId) {
    /*
      The state family, not a bare `<Card>` with a title and a sentence: this
      was the one state on the route drawn by hand, and on a page with no cards
      left it would have been the only card on the screen.

      **The whole-screen variant, unlike every other state on this half**, and
      lane 4 sets the precedent (`backwork-page.tsx` keeps `EmptyState` for
      exactly this early return). The others replace a *list* inside a page
      that still has a toolbar above it; this one replaces the page. There is
      no chapter, so there is nothing for a toolbar to filter.
    */
    return (
      <EmptyState
        title="No chapter selected"
        description="Pick a chapter to browse alumni."
      />
    );
  }

  /*
   * `useAlumni` sets `placeholderData: keepPreviousData`, so its `data` is
   * never `undefined` after the first load — `anyReadUncached` treats
   * placeholder rows as uncached, which is what stops this screen rendering
   * the previous filter's alumni under the new filter's chips.
   */
  if (isOffline && anyReadUncached(query)) {
    return (
      <NestedOffline
        sole
        title="Alumni unavailable offline"
        description="Reconnect to load alumni records."
        onRetry={() => {
          /*
           * Clearing the filters is the escape hatch, not a nicety. Committing
           * a filter offline keys the query to something never fetched, and
           * `keepPreviousData` makes that read `isPlaceholderData` — so this
           * card replaces the directory *including the filter form and its
           * Clear button*, and a paused `refetch()` can never dismiss it.
           * Without this reset the member is stranded on the card with rows
           * still in cache until the network returns.
           *
           * All four pieces of state reset together, not just `committed`,
           * which is the only one in the query key. Dropping the key alone
           * would cost them less typing but land them on the *unfiltered*
           * cached roster with "Austin" still in the City box and nothing
           * saying the filter no longer applies — a list labelled by a filter
           * it is not under, which is the confidently-wrong signal this whole
           * family exists to remove. Retyping three short inputs is the
           * cheaper loss. (`members-directory.tsx`'s guarded `setQuery("")`
           * reads like precedent for splitting them and is not: there the
           * input value *is* the query key via `deferredQuery`, so form and
           * results cannot diverge in the first place.)
           */
          clearFilters();
          void query.refetch();
        }}
      />
    );
  }

  return (
    <section aria-labelledby="alumni-list-label" className="space-y-3">
      {/*
        One toolbar row: the list's name and count on the left, its filter form
        on the right, on the page surface. `1f` pin 2.

        The three fields keep **visible** `EYEBROW` labels, inline rather than
        stacked in a four-column grid. An earlier draft made them `sr-only` and
        moved the label text into the placeholders — which is the
        placeholder-as-label regression: the accessible name survives, but a
        placeholder disappears the moment a value is typed, leaving three
        identical 160px boxes reading `2018 | Austin | Acme` with nothing saying
        which is which. The placeholders go back to carrying the format hint,
        which is the job only they can do.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2
            id="alumni-list-label"
            className={`${EYEBROW} truncate text-muted-foreground`}
          >
            Alumni
          </h2>
          {query.isSuccess ? (
            <p className="shrink-0 text-caption text-muted">
              {alumni.length} alum{alumni.length === 1 ? "" : "ni"}
            </p>
          ) : null}
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={applyFilters}
          aria-label="Filter alumni"
        >
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
            <Label
              htmlFor="alumni-grad-year"
              className={`${EYEBROW} text-muted-foreground`}
            >
              Graduation year
            </Label>
            <Input
              id="alumni-grad-year"
              value={graduationYear}
              onChange={(event) => setGraduationYear(event.target.value)}
              placeholder="e.g. 2018"
              inputMode="numeric"
              className="h-11 w-full sm:w-40"
            />
          </div>
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
            <Label
              htmlFor="alumni-city"
              className={`${EYEBROW} text-muted-foreground`}
            >
              City
            </Label>
            <Input
              id="alumni-city"
              value={cityFilter}
              onChange={(event) => setCityFilter(event.target.value)}
              placeholder="Austin, Chicago, …"
              className="h-11 w-full sm:w-40"
            />
          </div>
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
            <Label
              htmlFor="alumni-company"
              className={`${EYEBROW} text-muted-foreground`}
            >
              Company
            </Label>
            <Input
              id="alumni-company"
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
              placeholder="Employer or industry"
              className="h-11 w-full sm:w-40"
            />
          </div>
          <Button type="submit" size="sm" className="gap-2">
            <SearchGlyph className="h-4 w-4" />
            Apply filters
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={clearFilters}
          >
            Clear
          </Button>
        </form>
      </div>

      {query.isPending ? (
        <NestedLoading sole message="Loading alumni directory..." />
      ) : query.isError ? (
        <NestedError
          sole
          title="Couldn't load alumni"
          description="Check your chapter access."
          onRetry={() => void query.refetch()}
        />
      ) : alumni.length === 0 ? (
        filtered ? (
          <NestedEmpty
            sole
            title="No alumni match the filters"
            description="Clear a field to see more."
          />
        ) : (
          <NestedEmpty
            sole
            title="No alumni yet"
            description="Graduated members appear here."
          />
        )
      ) : (
        /*
          The actives list's row grammar, minus the two things an alumnus does
          not have: a checkbox (there is no bulk action here) and a presence dot
          (alumni are not on the chapter socket). Same `divide-y` + `border-t`
          rule, same 36/44 row, same `·`-joined meta line with the free-text
          field last so a long bio is what an ellipsis takes.

          `role="list"` for the reason `members-directory.tsx` spells out:
          flexing the `<li>` drops the semantics WebKit reads off it.
        */
        <ul role="list" className={denseListClassName}>
          {alumni.map((alum) => {
            const id = alum.id ?? alum.user_id;
            const name = memberLabel(alum.display_name, alum.user_id);
            /*
              The bounded fields only. The bio used to ride at the end of this
              join on lane 4's "free text last" rule, and that rule does not
              transfer: on `/documents` the description trails one short date
              and a folder name, where here three fields precede it in half a
              row, so an ellipsis took the bio in full at every width — and
              the row is no place to read a bio in full. It gets its own line
              below, and the whole of it is in the detail sheet.
            */
            const meta = [
              alum.graduation_year ? `Class of ${alum.graduation_year}` : null,
              alum.current_company,
              alum.current_city,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={id} className="flex">
                {/*
                  The row is the control, as on the actives list, and for the
                  same reason it carries an `aria-label` restating every fact
                  shown: the label replaces the subtree's text as the name.
                */}
                <button
                  type="button"
                  onClick={() => {
                    setOpenAlumnus(alum);
                    setSheetOpen(true);
                  }}
                  aria-label={[name, meta || null, alum.bio || null]
                    .filter(Boolean)
                    .join(", ")}
                  className={cn(
                    "flex min-h-9 min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-1 text-left transition-colors",
                    "pointer-coarse:min-h-11 hover:bg-accent-subtle hover:text-foreground",
                    FOCUS_RING_OFFSET,
                  )}
                >
                  <Avatar className="mt-0.5 h-6 w-6 shrink-0">
                    {alum.avatar_url ? (
                      <AvatarImage src={alum.avatar_url} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[9px]">
                      {initials(alum.display_name)}
                    </AvatarFallback>
                  </Avatar>
                  {/*
                    Name over meta below `sm`, side by side above it. Never
                    `hidden sm:block` on the meta line, which an earlier draft
                    did: on the screen whose entire purpose is class year,
                    company and city, that put all three in no visible form
                    below 640px. The row's `aria-label` would still carry them
                    now, but a sighted phone user reads the row, not the label.

                    Spans, not divs: a `<button>` may only hold phrasing
                    content, the same reason the actives row is built of spans.
                  */}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-3">
                      <span className="min-w-0 truncate text-sm font-semibold sm:flex-1">
                        {name}
                      </span>
                      <span className="min-w-0 truncate text-caption text-muted sm:flex-1">
                        {meta}
                      </span>
                    </span>
                    {alum.bio ? (
                      <span className="line-clamp-1 text-caption text-muted">
                        {alum.bio}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <MemberDetailSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        member={openAlumnus}
        // Alumni accrue no points (`spec/behavior/alumni.md`), and the
        // leaderboard this would come from ranks actives.
        points={null}
        usingPreviewData={false}
      />
    </section>
  );
}
