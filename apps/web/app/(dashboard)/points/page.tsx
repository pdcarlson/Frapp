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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, LoadingState, OfflineState } from "@/components/shared/async-states";
import { NestedEmpty } from "@/components/shared/nested-states";
import { amountToneClassName } from "@/components/points/amount-tone";
import {
  dashboardCheckboxCellClassName,
  dashboardCheckboxHitAreaClassName,
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { useNetwork } from "@/lib/providers/network-provider";
import { asArray, downloadCsv } from "@/lib/utils";
import { PointsAdjustmentDialog } from "@/components/points/points-adjustment-dialog";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { formatLocaleDateTime as formatTimestamp } from "@repo/formatting";
import { PointsAuditCard } from "@/components/points/points-audit-card";

const windows = [
  { label: "All Time", value: "all" as const },
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
  const [amountFilter, setAmountFilter] = useState<"all" | "positive" | "negative">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
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
  // stays `isLoading` across its whole retry sequence — with `retry: 3` and
  // 1s/2s/4s backoff, waiting on it would hide a board that is already in memory
  // for the better part of ten seconds and then show the fallback labels anyway.
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
    | { balance?: number; transactions?: PointTransactionRow[] }
    | undefined;
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
        transaction.category.toLowerCase() !== categoryFilter
      ) {
        return false;
      }
      if (
        query &&
        !transaction.description.toLowerCase().includes(query) &&
        !transaction.category.toLowerCase().includes(query)
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
  }, [window, semesterArchiveId, transactionSearch, amountFilter, categoryFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const transactionIds = filteredTransactions.map((transaction) => transaction.id);
  const allTransactionsSelected =
    transactionIds.length > 0 &&
    transactionIds.every((transactionId) => selectedTransactionIds.includes(transactionId));

  function exportSelectedTransactionsCsv() {
    const rows = filteredTransactions
      .filter((transaction) => selectedTransactionIds.includes(transaction.id))
      .map((transaction) => ({
        Amount: String(transaction.amount),
        Category: transaction.category,
        Description: transaction.description,
        Time: formatTimestamp(transaction.created_at),
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
      setSelectedTransactionIds((previous) => [
        ...new Set([...previous, id]),
      ]);
      return;
    }
    setSelectedTransactionIds((previous) =>
      previous.filter((prevId) => prevId !== id),
    );
  }

  if (isOffline) {
    return (
      <OfflineState
        title="Points ledger unavailable offline"
        description="Reconnect to refresh leaderboard standings and transaction history."
        onRetry={() => {
          void leaderboardQuery.refetch();
          void summaryQuery.refetch();
          // Names are refreshed alongside the reads that raised this card, so a
          // retry that fixes the board fixes the labels too. Not the only path
          // and not a complete one: a roster that fails while the points reads
          // succeed renders no card at all, and recovers on window focus or
          // reconnect (`query-provider.tsx`) rather than from any control here.
          // Giving that case a visible signal is #1209's.
          refetchRoster();
        }}
      />
    );
  }

  if (isLoading) {
    return <LoadingState message={stateMicrocopy.points.loading} />;
  }

  // The leaderboard and the ledger are what officers read chapter financial
  // standing off, so a failed fetch must not be papered over with plausible
  // rows (`spec/ui/resilience.md` §1: "Show, don't guess"). Failing the whole
  // page — rather than rendering a healthy-looking shell — also keeps the
  // adjust and bulk-export controls out of reach while the data is unknown,
  // matching how Members handles its supporting queries.
  if (hasError) {
    return (
      <ErrorState
        title={stateMicrocopy.points.errorTitle}
        description={stateMicrocopy.points.errorDescription}
        onRetry={() => {
          void leaderboardQuery.refetch();
          void summaryQuery.refetch();
          // Names are refreshed alongside the reads that raised this card, so a
          // retry that fixes the board fixes the labels too. Not the only path
          // and not a complete one: a roster that fails while the points reads
          // succeed renders no card at all, and recovers on window focus or
          // reconnect (`query-provider.tsx`) rather than from any control here.
          // Giving that case a visible signal is #1209's.
          refetchRoster();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        {/*
          Stacked below `sm` (#1142): the title plus "Adjust points" and the
          three window buttons cannot share a row inside a 375px viewport, and
          every one of them is `whitespace-nowrap`. Scoped with `max-sm:` rather
          than written mobile-first on purpose — at `sm` and above the class list
          resolves to exactly what it was, so the pinned 1440px visual baseline
          for this route does not move.
        */}
        <CardHeader className="flex flex-row items-center justify-between max-sm:flex-col max-sm:items-start max-sm:gap-3 max-sm:space-y-0">
          <div>
            <CardTitle>Points Ledger</CardTitle>
            <CardDescription>
              Track chapter ranking, manual adjustments, and transaction history.
            </CardDescription>
          </div>
          {/* `flex-wrap` is inert at desktop width and lets the four nowrap
              buttons stack instead of overflow at 375px. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              {...adjustGate.controlProps()}
              onClick={() => adjustDialog.setOpen(true)}
            >
              <AdjustGlyph className="h-4 w-4" />
              Adjust points
            </Button>
            {windows.map((item) => (
              <Button
                key={item.value}
                // Selecting an archived period below overrides `window`
                // entirely, so none of these read as "active" while one is
                // chosen — reselecting one here is what returns to live mode.
                variant={
                  !semesterArchiveId && window === item.value
                    ? "default"
                    : "secondary"
                }
                size="sm"
                onClick={() => {
                  setWindow(item.value);
                  setSemesterArchiveId("");
                }}
              >
                {item.label}
              </Button>
            ))}
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
          </div>
        </CardHeader>
        <CardContent>
          {/*
            The all/semester/month window buttons beside the trigger are reads
            and stay live — a lapsed chapter keeps its full ledger history.
          */}
          <SubscriptionNotice
            gate={adjustGate}
            feature="point adjustments"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary">My balance</Badge>
            <p className="text-2xl font-bold tabular-nums">
              {typeof summary?.balance === "number" ? summary.balance : 0} points
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Leaderboard</CardTitle>
            <CardDescription>Current ranking for selected time window.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 relative">
              <SearchGlyph className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={leaderboardSearch}
                onChange={(event) => setLeaderboardSearch(event.target.value)}
                placeholder="Search by member name"
                className="h-11 pl-9"
              />
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLeaderboard.map((entry) => (
                    <TableRow key={entry.user_id}>
                      <TableCell className="font-mono tabular-nums">#{entry.rank}</TableCell>
                      {/*
                        foundations §7 reserves mono for ids, tokens, keys and
                        points cells. This cell now holds a person, not an id —
                        even the unresolved fallback is a `Member …` label — so
                        it is no longer one of them.
                      */}
                      <TableCell className="text-[12.5px]">
                        {entry.label}
                      </TableCell>
                      <TableCell className="font-mono font-semibold tabular-nums">
                        {entry.total}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">My Transactions</CardTitle>
            <CardDescription>Most recent point activity in this window.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <div className="relative">
                <SearchGlyph className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={transactionSearch}
                  onChange={(event) => setTransactionSearch(event.target.value)}
                  placeholder="Search descriptions"
                  className="h-11 pl-9"
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
                <option value="attendance">Attendance</option>
                <option value="study">Study</option>
                <option value="fine">Fine</option>
                <option value="manual">Manual</option>
                <option value="service">Service</option>
              </select>
            </div>
            {selectedTransactionIds.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-border bg-accent-subtle p-3">
                <p className="text-sm font-semibold">
                  {selectedTransactionIds.length} transaction
                  {selectedTransactionIds.length > 1 ? "s" : ""} selected
                </p>
                {/*
                  Flag for audit removed rather than wired (#336): flags are
                  raised automatically whenever a single adjustment *reaches*
                  the chapter's configured anomaly threshold (#394 — default
                  ±100, see PointsAuditCard below) — there is no manual
                  override to call, and adding one would be a new moderation
                  feature rather than a wiring fix.
                */}
                <Button
                  size="sm"
                  variant="secondary"
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={dashboardCheckboxCellClassName}>
                      <label className={dashboardCheckboxHitAreaClassName}>
                        <input
                          type="checkbox"
                          aria-label="Select all visible transactions"
                          className={dashboardTableCheckboxClassName}
                          checked={allTransactionsSelected}
                          onChange={(event) => toggleAllTransactions(event.target.checked)}
                        />
                      </label>
                    </TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((transaction) => (
                    <TableRow
                      key={transaction.id}
                      data-state={
                        selectedTransactionIds.includes(transaction.id)
                          ? "selected"
                          : undefined
                      }
                    >
                      <TableCell className={dashboardCheckboxCellClassName}>
                        <label className={dashboardCheckboxHitAreaClassName}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${transaction.description}`}
                            className={dashboardTableCheckboxClassName}
                            checked={selectedTransactionIds.includes(transaction.id)}
                            onChange={(event) =>
                              toggleTransaction(transaction.id, event.target.checked)
                            }
                          />
                        </label>
                      </TableCell>
                      <TableCell
                        className={amountToneClassName(transaction.amount)}
                      >
                        {transaction.amount >= 0 ? `+${transaction.amount}` : transaction.amount}
                      </TableCell>
                      <TableCell>{transaction.category}</TableCell>
                      <TableCell>{transaction.description}</TableCell>
                      <TableCell className="text-[12.5px] text-muted-foreground">
                        {formatTimestamp(transaction.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <PointsAuditCard />

      <PointsAdjustmentDialog
        open={adjustDialog.open}
        onOpenChange={adjustDialog.setOpen}
        onCloseAutoFocus={adjustDialog.contentProps.onCloseAutoFocus}
        onAdjusted={async () => {
          await Promise.all([leaderboardQuery.refetch(), summaryQuery.refetch()]);
        }}
      />
    </div>
  );
}
