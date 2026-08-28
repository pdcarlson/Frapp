"use client";

import { useMemo, useState } from "react";
import { AdjustGlyph, SearchGlyph } from "@/components/points/points-glyphs";
import { useLeaderboard, useMemberDisplayNames, useMyPoints } from "@repo/hooks";
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
import { useToast } from "@/hooks/use-toast";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { useNetwork } from "@/lib/providers/network-provider";
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

type PointTransactionRow = {
  id: string;
  amount: number;
  category: string;
  description: string;
  created_at: string;
};

export default function PointsPage() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const [window, setWindow] = useState<"all" | "semester" | "month">("all");
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
  const leaderboardQuery = useLeaderboard(window);
  const summaryQuery = useMyPoints(window);
  // `GET /v1/points/leaderboard` returns `{ user_id, total }` and no name, so the
  // roster is what turns a rank into a person (#1197). `useMemberDisplayNames`
  // rather than `useMembers`: this cell needs one string per row, and the full
  // profile route would ship every member's email, bio, graduation year, city
  // and company to everyone who opens /points — see the note on
  // `useChapterRoster` in `packages/hooks/src/use-members.ts` (#1000, #986).
  const { nameFor, isPending: isRosterPending } = useMemberDisplayNames();

  // The roster joins the loading gate so ranks do not render as UUIDs for a
  // frame and then re-label. It deliberately does NOT join `hasError`: a failed
  // roster degrades names to ids, and the board is still accurate and usable, so
  // replacing it with an error card would be the worse outcome (#1209 owns
  // surfacing that degradation, and names /points as a call site).
  const isLoading =
    leaderboardQuery.isLoading || summaryQuery.isLoading || isRosterPending;
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
  // One projection drives the cell, its type treatment and the search needle, so
  // a row can never display one string and match another.
  const leaderboardRows = useMemo(() => {
    return leaderboard.map((entry) => {
      // `null` for an unset name as well as a missing member: `display_name` is
      // `NOT NULL DEFAULT ''`, so `resolveDisplayName` treats '' as unresolved
      // rather than rendering a blank cell. Someone who has left the chapter is
      // off the roster but keeps their points, so a raw id is a real outcome.
      const name = nameFor(entry.user_id);
      return { ...entry, label: name ?? entry.user_id, isNamed: name !== null };
    });
    // `nameFor` and not the whole hook result: `useMemberDisplayNames` returns a
    // fresh object every render, so depending on it would rebuild this list each
    // time. `nameFor` is a `useCallback` keyed on the roster data itself.
  }, [leaderboard, nameFor]);

  const filteredLeaderboard = useMemo(() => {
    const query = leaderboardSearch.trim().toLowerCase();
    if (!query) return leaderboardRows;
    return leaderboardRows.filter((entry) =>
      entry.label.toLowerCase().includes(query),
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
  const transactionIds = filteredTransactions.map((transaction) => transaction.id);
  const allTransactionsSelected =
    transactionIds.length > 0 &&
    transactionIds.every((transactionId) => selectedTransactionIds.includes(transactionId));

  function handleBulkTransactionAction(actionLabel: string) {
    toast({
      title: "Bulk points action queued",
      description: `${actionLabel} for ${selectedTransactionIds.length} selected transaction${selectedTransactionIds.length > 1 ? "s" : ""} is not available yet.`,
    });
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
                variant={window === item.value ? "default" : "secondary"}
                size="sm"
                onClick={() => setWindow(item.value)}
              >
                {item.label}
              </Button>
            ))}
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
              <NestedEmpty
                title={stateMicrocopy.points.emptyLeaderboardTitle}
                description={stateMicrocopy.points.emptyLeaderboardDescription}
              />
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
                  {filteredLeaderboard.map((entry, index) => (
                    <TableRow key={entry.user_id}>
                      <TableCell className="font-mono tabular-nums">#{index + 1}</TableCell>
                      {/*
                        foundations §7 reserves mono for ids, tokens, keys and
                        points cells — a member's name is none of those, so the
                        family follows the value rather than the column.
                      */}
                      <TableCell
                        className={
                          entry.isNamed
                            ? "text-[12.5px]"
                            : "font-mono text-[12.5px]"
                        }
                      >
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
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleBulkTransactionAction("Export selected")}
                  >
                    Export selected
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleBulkTransactionAction("Flag for audit")}
                  >
                    Flag for audit
                  </Button>
                </div>
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
