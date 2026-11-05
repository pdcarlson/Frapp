"use client";

import { useEffect, useMemo, useState } from "react";
import { AdjustGlyph, SearchGlyph } from "@/components/points/points-glyphs";
import {
  memberFallbackLabel,
  useLeaderboard,
  useMemberDisplayNames,
  useMyPoints,
  useSemesters,
  type SemesterArchive,
} from "@repo/hooks";
import { formatDay, formatTimestampFull } from "@repo/formatting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { anyReadUncached } from "@/components/shared/async-states";
import {
  NestedEmpty,
  NestedError,
  NestedOffline,
} from "@/components/shared/nested-states";
import { SectionLabel } from "@/components/shared/section-label";
import { PageActions } from "@/components/layout/page-actions";
import { amountToneClassName } from "@/components/points/amount-tone";
import {
  POINT_CATEGORIES,
  pointCategoryLabel,
} from "@/components/points/point-category";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
  dashboardToolbarSearchClassName,
  dashboardToolbarSearchGlyphClassName,
  denseListClassName,
} from "@/components/shared/table-controls";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { useNetwork } from "@/lib/providers/network-provider";
import { asArray, cn, downloadCsv } from "@/lib/utils";
import { PointsAdjustmentDialog } from "@/components/points/points-adjustment-dialog";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { PointsAuditCard } from "@/components/points/points-audit-card";
import { PointsPageSkeleton } from "@/components/points/points-skeleton";

const windows = [
  { label: "All time", value: "all" as const },
  { label: "Semester", value: "semester" as const },
  { label: "Month", value: "month" as const },
];

type LeaderboardRow = {
  user_id: string;
  total: number;
};

/**
 * A search needle long enough, and narrow enough, to be a pasted user id rather
 * than a name. Hex and dashes only, so it cannot fire on ordinary typing.
 */
const ID_SHAPED_QUERY = /^[0-9a-f-]{8,}$/;

type PointTransactionRow = {
  id: string;
  amount: number;
  category: string;
  description: string;
  created_at: string;
};

export default function PointsPage() {
  const { isOffline } = useNetwork();
  const [window, setWindow] = useState<"all" | "semester" | "month">("all");
  // Selecting a specific archived period overrides `window` entirely (see
  // PointsService.getLeaderboard) — "" means "use the window buttons", not "no
  // filter", so it never collides with a real archive id.
  const [semesterArchiveId, setSemesterArchiveId] = useState("");
  const [leaderboardSearch, setLeaderboardSearch] = useState("");
  const [transactionSearch, setTransactionSearch] = useState("");
  const [amountFilter, setAmountFilter] = useState<
    "all" | "positive" | "negative"
  >("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<
    string[]
  >([]);
  // `POST /v1/points/adjust` is paid-ops. The dialog gates its own fields, but
  // `open` is owned here, so §5 rule 1 — refuse to open onto a doomed form —
  // has to be enforced at this trigger (#841).
  const adjustGate = useSubscriptionGate();
  const adjustDialog = useGatedDialog(adjustGate);
  const leaderboardQuery = useLeaderboard(
    window,
    semesterArchiveId || undefined,
  );
  const summaryQuery = useMyPoints(window, semesterArchiveId || undefined);
  const semestersQuery = useSemesters();
  const archives = useMemo(
    () => asArray<SemesterArchive>(semestersQuery.data),
    [semestersQuery.data],
  );
  // `GET /v1/points/leaderboard` returns `{ user_id, total }` and no name, so the
  // roster is what turns a rank into a person (#1197). `useMemberDisplayNames`
  // rather than `useMembers`: this cell needs one string per row, and the full
  // profile route carries every member's email, bio, graduation year, city and
  // company — see the note on `useChapterRoster` in
  // `packages/hooks/src/use-members.ts` (#1000, #986).
  const { nameFor, refetch: refetchRoster } = useMemberDisplayNames();

  // The roster gates nothing, at either scope. It feeds one column, and a query
  // stays `isLoading` across its whole retry sequence. The query provider
  // retries a 5xx or a dropped request three times with 1s/2s/4s backoff, so
  // waiting on it would hide a board that is already in memory for the better
  // part of ten seconds and then show the fallback labels anyway.
  // Rows render as soon as their totals arrive and names land when they land;
  // the unresolved label is a real, permanent state for departed members, so an
  // unnamed row is never a broken-looking one.
  const isLoading = leaderboardQuery.isLoading || summaryQuery.isLoading;
  const hasError = leaderboardQuery.isError || summaryQuery.isError;

  const leaderboard = useMemo(() => {
    return Array.isArray(leaderboardQuery.data)
      ? (leaderboardQuery.data as LeaderboardRow[])
      : [];
  }, [leaderboardQuery.data]);

  const summary = summaryQuery.data as
    { balance?: number; transactions?: PointTransactionRow[] } | undefined;
  const transactions = useMemo(() => {
    return Array.isArray(summary?.transactions) ? summary.transactions : [];
  }, [summary]);
  // One projection drives the label and the rank, so neither can disagree with
  // what the row is.
  const leaderboardRows = useMemo(() => {
    return leaderboard.map((entry, index) => {
      // Rank belongs to the board, not to the filtered view. It used to be the
      // render index, which was survivable while the search only matched uuids
      // that nobody typed; naming the rows makes filtering an everyday action,
      // and a rank renumbered from #1 per search would misreport chapter
      // standing on the surface officers read it off.
      const rank = index + 1;
      // `null` for an unset name as well as a missing member: `display_name` is
      // `NOT NULL DEFAULT ''`, so `resolveDisplayName` treats '' as unresolved
      // rather than rendering a blank cell. Someone who has left the chapter is
      // off the roster but keeps their points (`spec/behavior/points.md`), so an
      // unresolved row is a permanent state for them rather than a fault.
      //
      // `memberFallbackLabel` is the shared spelling, which chat already uses
      // via `resolveAuthorLabel`. The task board hand-rolls the identical six
      // characters and the member directory hand-rolls *eight* — that
      // divergence is why this now lives in one place (#1197 follow-up tracks
      // migrating those two).
      const name = nameFor(entry.user_id);
      return {
        ...entry,
        rank,
        label: name ?? memberFallbackLabel(entry.user_id),
      };
    });
    // `nameFor` and not the whole hook result: `useMemberDisplayNames` returns a
    // fresh object every render, so depending on it would rebuild this list each
    // time. `nameFor` is a `useCallback` keyed on the roster data itself.
  }, [leaderboard, nameFor]);

  const filteredLeaderboard = useMemo(() => {
    const query = leaderboardSearch.trim().toLowerCase();
    if (!query) return leaderboardRows;
    // The id stays a needle alongside the name — officers paste user ids out of
    // audit rows and support tickets, and that was the only thing this box
    // matched before names existed. But only for a query that looks like one:
    // the id is no longer rendered, so matching it on any input means matching
    // invisible text. A uuid is 32 hex characters, so "a" occurs in ~87% of
    // them and the first keystroke of a name search would leave the whole board
    // standing with nothing on screen explaining why.
    const byId = ID_SHAPED_QUERY.test(query);
    return leaderboardRows.filter(
      (entry) =>
        entry.label.toLowerCase().includes(query) ||
        (byId && entry.user_id.toLowerCase().includes(query)),
    );
  }, [leaderboardRows, leaderboardSearch]);
  const filteredTransactions = useMemo(() => {
    const query = transactionSearch.trim().toLowerCase();
    return transactions.filter((transaction) => {
      if (amountFilter === "positive" && transaction.amount < 0) {
        return false;
      }
      if (amountFilter === "negative" && transaction.amount >= 0) {
        return false;
      }
      if (
        categoryFilter !== "all" &&
        transaction.category.toUpperCase() !== categoryFilter
      ) {
        return false;
      }
      // The label, not the token: the search matches what the row shows.
      const categoryLabel = pointCategoryLabel(transaction.category) ?? "";
      if (
        query &&
        !transaction.description.toLowerCase().includes(query) &&
        !categoryLabel.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
  }, [transactions, transactionSearch, amountFilter, categoryFilter]);

  // Changing the window, search, or amount/category filter swaps the visible
  // population, so drop the selection — otherwise the bulk bar keeps counting
  // transactions that are no longer shown, and Export selected silently
  // exports fewer rows than it claims (or an empty file once none of the
  // selection remains visible).
  /* eslint-disable react-hooks/set-state-in-effect -- reset selection when the visible transaction set changes */
  useEffect(() => {
    setSelectedTransactionIds([]);
  }, [
    window,
    semesterArchiveId,
    transactionSearch,
    amountFilter,
    categoryFilter,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const transactionIds = filteredTransactions.map(
    (transaction) => transaction.id,
  );
  const allTransactionsSelected =
    transactionIds.length > 0 &&
    transactionIds.every((transactionId) =>
      selectedTransactionIds.includes(transactionId),
    );

  function exportSelectedTransactionsCsv() {
    const rows = filteredTransactions
      .filter((transaction) => selectedTransactionIds.includes(transaction.id))
      .map((transaction) => ({
        Amount: String(transaction.amount),
        Category:
          pointCategoryLabel(transaction.category) ?? transaction.category,
        Description: transaction.description,
        // ISO, not a display shape: a spreadsheet sorts and parses this column,
        // and a locale string with no year or zone would lose both.
        Time: transaction.created_at,
      }));
    downloadCsv(rows, "points");
  }

  function toggleAllTransactions(checked: boolean) {
    if (checked) {
      setSelectedTransactionIds((previous) => [
        ...new Set([...previous, ...transactionIds]),
      ]);
      return;
    }
    setSelectedTransactionIds((previous) =>
      previous.filter((id) => !transactionIds.includes(id)),
    );
  }

  function toggleTransaction(id: string, checked: boolean) {
    if (checked) {
      setSelectedTransactionIds((previous) => [...new Set([...previous, id])]);
      return;
    }
    setSelectedTransactionIds((previous) =>
      previous.filter((prevId) => prevId !== id),
    );
  }

  /*
   * The roster is deliberately absent from this gate, matching the reasoning
   * on `isLoading` above: it gates nothing, feeds one column, and its
   * unresolved label is a real permanent state for a departed member rather
   * than a broken-looking one. Only the two reads the board and the ledger are
   * actually made of belong here.
   *
   * Every path below is the nested state family with `sole`, under the top
   * bar's page title. The whole-screen `LoadingState` / `ErrorState` /
   * `OfflineState` paint `--card`, which on a flush route redraws the card the
   * route deleted (`spec/ui/web-dashboard/README.md` § Page grammar); `sole`
   * gives the nested one back the live region and heading a page's only state
   * needs.
   */
  if (isOffline && anyReadUncached(leaderboardQuery, summaryQuery)) {
    return (
      <div className="space-y-6">
        <NestedOffline
          sole
          title="Points ledger unavailable offline"
          description="Reconnect to refresh leaderboard standings and transaction history."
          onRetry={() => {
            /*
             * Both reads key on `window` and `semesterArchiveId`, and the
             * controls that set them render only on the loaded page — so
             * changing either offline swaps to a never-fetched key and this
             * branch unmounts the only way back. Resetting to the default
             * selection is what lets Retry reach cached rows; a paused refetch
             * alone cannot.
             */
            setWindow("all");
            setSemesterArchiveId("");
            void leaderboardQuery.refetch();
            void summaryQuery.refetch();
            // Names are refreshed alongside the reads that raised this state,
            // so a retry that fixes the board fixes the labels too. Not the
            // only path and not a complete one: a roster that fails while the
            // points reads succeed renders no state at all, and recovers on
            // window focus or reconnect (`query-provider.tsx`) rather than
            // from any control here. Giving that case a visible signal is
            // #1209's.
            refetchRoster();
          }}
        />
      </div>
    );
  }

  if (isLoading) {
    return <PointsPageSkeleton />;
  }

  // The leaderboard and the ledger are what officers read chapter financial
  // standing off, so a failed fetch must not be papered over with plausible
  // rows (`spec/ui/resilience/principles.md`: "Show, don't guess"). Failing the whole
  // page — rather than rendering a healthy-looking shell — also keeps the
  // adjust and bulk-export controls out of reach while the data is unknown,
  // matching how Members handles its supporting queries.
  if (hasError) {
    return (
      <div className="space-y-6">
        <NestedError
          sole
          title={stateMicrocopy.points.errorTitle}
          description={stateMicrocopy.points.errorDescription}
          onRetry={() => {
            void leaderboardQuery.refetch();
            void summaryQuery.refetch();
            // Names are refreshed alongside the reads that raised this state,
            // so a retry that fixes the board fixes the labels too (#1209
            // owns the roster-only failure, which raises nothing here).
            refetchRoster();
          }}
        />
      </div>
    );
  }

  const balance = typeof summary?.balance === "number" ? summary.balance : 0;
  const selectedCount = selectedTransactionIds.length;

  return (
    <div className="space-y-6">
      {/*
        One toolbar row: the window choice, the archive picker and the route's
        action, rather than a summary card. `PageActions` wraps them once the
        row runs out of width, which is what holds the 375px floor (#1142 was
        this row overflowing inside the old card header).
      */}
      <PageActions>
        {/*
            A segmented choice, not three primaries: the selected window is
            the outlined Secondary and the others are Quiet, so the row's
            filled control is never a filter. `aria-pressed` carries the
            selection, which the fill alone used to.
          */}
        <div
          role="group"
          aria-label="Time window"
          className="flex items-center gap-1"
        >
          {windows.map((item) => {
            // Selecting an archived period overrides `window` entirely,
            // so none of these reads as selected while one is chosen —
            // reselecting one here is what returns to live mode.
            const active = !semesterArchiveId && window === item.value;
            return (
              <Button
                key={item.value}
                variant={active ? "secondary" : "quiet"}
                size="toolbar"
                aria-pressed={active}
                onClick={() => {
                  setWindow(item.value);
                  setSemesterArchiveId("");
                }}
              >
                {item.label}
              </Button>
            );
          })}
        </div>
        {archives.length > 0 ? (
          <select
            aria-label="View an archived semester"
            value={semesterArchiveId}
            onChange={(event) => setSemesterArchiveId(event.target.value)}
            className={dashboardFilterSelectClassName}
          >
            <option value="">Archived period…</option>
            {archives.map((archive) => (
              <option key={archive.id} value={archive.id}>
                {archive.label}
              </option>
            ))}
          </select>
        ) : null}
        {/*
            The window buttons beside this trigger are reads and stay live
            while it is gated: a lapsed chapter keeps its full ledger history.
          */}
        <Button
          size="toolbar"
          variant="secondary"
          className="gap-2"
          {...adjustGate.controlProps()}
          onClick={() => adjustDialog.setOpen(true)}
        >
          <AdjustGlyph className="h-4 w-4" />
          Adjust points
        </Button>
      </PageActions>

      <SubscriptionNotice gate={adjustGate} feature="point adjustments" />

      {/* A stat on the page surface: the label over the number, no frame. */}
      <dl className="space-y-0.5">
        <dt className="text-caption text-muted-foreground">My balance</dt>
        <dd className="text-headline font-bold tabular-nums text-foreground">
          {balance}{" "}
          <span className="text-label font-semibold text-muted-foreground">
            points
          </span>
        </dd>
      </dl>

      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <section
          aria-labelledby="points-leaderboard-label"
          className="min-w-0 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <SectionLabel
              id="points-leaderboard-label"
              count={
                leaderboardRows.length > 0
                  ? `${leaderboardRows.length} member${leaderboardRows.length === 1 ? "" : "s"}`
                  : null
              }
            >
              Leaderboard
            </SectionLabel>
            <div className="relative w-full sm:w-56">
              <Label htmlFor="points-leaderboard-search" className="sr-only">
                Search the leaderboard
              </Label>
              <SearchGlyph className={dashboardToolbarSearchGlyphClassName} />
              <Input
                id="points-leaderboard-search"
                type="search"
                value={leaderboardSearch}
                onChange={(event) => setLeaderboardSearch(event.target.value)}
                placeholder="Search members"
                className={dashboardToolbarSearchClassName}
              />
            </div>
          </div>
          {filteredLeaderboard.length === 0 ? (
            // A search that matches nothing is not an empty board — saying
            // "point activity will populate after..." there would assert
            // something false about the chapter's data.
            leaderboardRows.length > 0 ? (
              <NestedEmpty
                title={stateMicrocopy.points.noLeaderboardMatchesTitle}
                description={
                  stateMicrocopy.points.noLeaderboardMatchesDescription
                }
              />
            ) : (
              <NestedEmpty
                title={stateMicrocopy.points.emptyLeaderboardTitle}
                description={stateMicrocopy.points.emptyLeaderboardDescription}
              />
            )
          ) : (
            // `role="list"` restated: a flex `<li>` loses its `list-item` box,
            // and WebKit then stops exposing the list and its item count.
            <ul role="list" className={denseListClassName}>
              {filteredLeaderboard.map((entry) => (
                <li
                  key={entry.user_id}
                  className="flex min-h-11 items-center gap-3"
                >
                  <span className="w-10 shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
                    {`#${entry.rank}`}
                  </span>
                  {/*
                    foundations §7 reserves mono for ids, tokens, keys and
                    points cells. This holds a person, not an id — even the
                    unresolved fallback is a `Member …` label — so it is not
                    one of them.
                  */}
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {entry.label}
                  </span>
                  <span className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                    {entry.total}
                    <span className="sr-only"> points</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="points-transactions-label"
          className="min-w-0 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <SectionLabel
              id="points-transactions-label"
              count={
                transactions.length > 0
                  ? `${transactions.length} transaction${transactions.length === 1 ? "" : "s"}`
                  : null
              }
            >
              My transactions
            </SectionLabel>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-48">
                <Label htmlFor="points-transaction-search" className="sr-only">
                  Search transactions
                </Label>
                <SearchGlyph className={dashboardToolbarSearchGlyphClassName} />
                <Input
                  id="points-transaction-search"
                  type="search"
                  value={transactionSearch}
                  onChange={(event) => setTransactionSearch(event.target.value)}
                  placeholder="Search transactions"
                  className={dashboardToolbarSearchClassName}
                />
              </div>
              <select
                aria-label="Filter transactions by amount"
                value={amountFilter}
                onChange={(event) =>
                  setAmountFilter(
                    event.target.value as "all" | "positive" | "negative",
                  )
                }
                className={dashboardFilterSelectClassName}
              >
                <option value="all">Amount: All</option>
                <option value="positive">Amount: Positive</option>
                <option value="negative">Amount: Negative</option>
              </select>
              <select
                aria-label="Filter transactions by category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className={dashboardFilterSelectClassName}
              >
                <option value="all">Category: All</option>
                {POINT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {`Category: ${pointCategoryLabel(category)}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/*
            The selection bar: a flush tinted strip, and only the count and
            the bulk action are conditional. Flag for audit was removed rather
            than wired (#336): flags are raised automatically whenever a single
            adjustment *reaches* the chapter's configured anomaly threshold
            (#394 — default ±100, see PointsAuditCard below), so there is no
            manual override to call.
          */}
          {selectedCount > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent-border bg-accent-subtle px-2 py-1.5">
              <p className="text-caption font-semibold text-accent-text">
                {`${selectedCount} transaction${selectedCount > 1 ? "s" : ""} selected`}
              </p>
              <Button
                size="toolbar"
                variant="secondary"
                className="sm:ml-auto"
                onClick={exportSelectedTransactionsCsv}
              >
                Export selected
              </Button>
            </div>
          ) : null}
          {filteredTransactions.length === 0 ? (
            <NestedEmpty
              title={stateMicrocopy.points.emptyTransactionsTitle}
              description={stateMicrocopy.points.emptyTransactionsDescription}
            />
          ) : (
            <>
              {/*
                The select-all lives in the always-rendered list header, not
                in the selection bar: inside the bar it would be unreachable
                until a row was ticked, and unticking it would unmount the
                control that has focus (README § Page grammar).
              */}
              <label className="flex w-fit min-h-9 cursor-pointer items-center gap-2 text-caption text-muted-foreground pointer-coarse:min-h-11">
                <span className={dashboardCheckboxHitAreaClassName}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible transactions"
                    className={dashboardTableCheckboxClassName}
                    checked={allTransactionsSelected}
                    onChange={(event) =>
                      toggleAllTransactions(event.target.checked)
                    }
                  />
                </span>
                Select all
              </label>
              <ul role="list" className={denseListClassName}>
                {filteredTransactions.map((transaction) => {
                  const selected = selectedTransactionIds.includes(
                    transaction.id,
                  );
                  const categoryLabel = pointCategoryLabel(
                    transaction.category,
                  );
                  const day = formatDay(transaction.created_at);
                  // The reason is the row's title; a transaction without one
                  // is titled by its category instead, and the meta line then
                  // drops the category rather than saying it twice.
                  const title = transaction.description || categoryLabel;
                  const metaCategory = transaction.description
                    ? categoryLabel
                    : null;
                  return (
                    <li
                      key={transaction.id}
                      className={cn(
                        "flex min-h-11 items-center gap-2 py-1.5",
                        // Fill means state, never striping.
                        selected && "bg-accent-subtle-hover",
                      )}
                    >
                      <label
                        className={`${dashboardCheckboxHitAreaClassName} shrink-0`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${title ?? "transaction"}`}
                          className={dashboardTableCheckboxClassName}
                          checked={selected}
                          onChange={(event) =>
                            toggleTransaction(
                              transaction.id,
                              event.target.checked,
                            )
                          }
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        {title ? (
                          <p className="truncate text-sm text-foreground">
                            {title}
                          </p>
                        ) : null}
                        {metaCategory || day ? (
                          <p className="truncate text-caption text-muted-foreground">
                            {metaCategory}
                            {metaCategory && day ? " · " : null}
                            {day ? (
                              <time
                                dateTime={transaction.created_at}
                                title={
                                  formatTimestampFull(transaction.created_at) ??
                                  undefined
                                }
                              >
                                {day}
                              </time>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          amountToneClassName(transaction.amount, "sm"),
                          "shrink-0 text-right",
                        )}
                      >
                        {transaction.amount >= 0
                          ? `+${transaction.amount}`
                          : `${transaction.amount}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>

      <PointsAuditCard />

      <PointsAdjustmentDialog
        open={adjustDialog.open}
        onOpenChange={adjustDialog.setOpen}
        onCloseAutoFocus={adjustDialog.contentProps.onCloseAutoFocus}
        onAdjusted={async () => {
          await Promise.all([
            leaderboardQuery.refetch(),
            summaryQuery.refetch(),
          ]);
        }}
      />
    </div>
  );
}
