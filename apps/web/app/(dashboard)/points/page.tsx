"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useLeaderboard, useMyPoints } from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingState } from "@/components/shared/async-states";
import {
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";

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
const fallbackLeaderboard: LeaderboardRow[] = [
  { user_id: "preview-user-1", total: 320 },
  { user_id: "preview-user-2", total: 295 },
  { user_id: "preview-user-3", total: 244 },
];
const fallbackTransactions: PointTransactionRow[] = [
  {
    id: "preview-txn-1",
    amount: 10,
    category: "ATTENDANCE",
    description: "Chapter Meeting check-in",
    created_at: new Date().toISOString(),
  },
  {
    id: "preview-txn-2",
    amount: 6,
    category: "STUDY",
    description: "Library geofence session",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: "preview-txn-3",
    amount: -3,
    category: "FINE",
    description: "Late arrival adjustment",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(),
  },
];

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export default function PointsPage() {
  const [window, setWindow] = useState<"all" | "semester" | "month">("all");
  const [leaderboardSearch, setLeaderboardSearch] = useState("");
  const [transactionSearch, setTransactionSearch] = useState("");
  const [amountFilter, setAmountFilter] = useState<"all" | "positive" | "negative">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const leaderboardQuery = useLeaderboard(window);
  const summaryQuery = useMyPoints(window);
  const usingPreviewData = leaderboardQuery.isError || summaryQuery.isError;

  const isLoading = leaderboardQuery.isLoading || summaryQuery.isLoading;

  const leaderboard = useMemo(() => {
    if (usingPreviewData) {
      return fallbackLeaderboard;
    }
    return Array.isArray(leaderboardQuery.data)
      ? (leaderboardQuery.data as LeaderboardRow[])
      : [];
  }, [usingPreviewData, leaderboardQuery.data]);

  const summary = summaryQuery.data as
    | { balance?: number; transactions?: PointTransactionRow[] }
    | undefined;
  const transactions = useMemo(() => {
    if (usingPreviewData) {
      return fallbackTransactions;
    }
    return Array.isArray(summary?.transactions) ? summary.transactions : [];
  }, [usingPreviewData, summary?.transactions]);
  const filteredLeaderboard = useMemo(() => {
    const query = leaderboardSearch.trim().toLowerCase();
    if (!query) return leaderboard;
    return leaderboard.filter((entry) =>
      entry.user_id.toLowerCase().includes(query),
    );
  }, [leaderboard, leaderboardSearch]);
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

  if (isLoading) {
    return <LoadingState message="Loading points ledger..." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Points Ledger</CardTitle>
            <CardDescription>
              Track chapter ranking, manual adjustments, and transaction history.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {windows.map((item) => (
              <Button
                key={item.value}
                variant={window === item.value ? "default" : "outline"}
                size="sm"
                onClick={() => setWindow(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">{usingPreviewData ? "Preview balance" : "My balance"}</Badge>
          <p className="text-2xl font-semibold">
            {usingPreviewData
              ? 186
              : typeof summary?.balance === "number"
                ? summary.balance
                : 0} points
          </p>
        </CardContent>
      </Card>

      {usingPreviewData ? (
        <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                Showing preview points data
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Sign in to load live leaderboard and transaction records.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                leaderboardQuery.refetch();
                summaryQuery.refetch();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Leaderboard</CardTitle>
            <CardDescription>Current ranking for selected time window.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={leaderboardSearch}
                onChange={(event) => setLeaderboardSearch(event.target.value)}
                placeholder="Search by user id"
                className="pl-9"
              />
            </div>
            {filteredLeaderboard.length === 0 ? (
              <EmptyState
                title="No leaderboard entries"
                description="Point activity will populate after attendance, study, or admin adjustments."
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
                      <TableCell>#{index + 1}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.user_id}
                      </TableCell>
                      <TableCell className="font-semibold">{entry.total}</TableCell>
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
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={transactionSearch}
                  onChange={(event) => setTransactionSearch(event.target.value)}
                  placeholder="Search descriptions"
                  className="pl-9"
                />
              </div>
              <select
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
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary-50/70 p-3 dark:bg-primary/10">
                <p className="text-sm font-medium">
                  {selectedTransactionIds.length} transaction
                  {selectedTransactionIds.length > 1 ? "s" : ""} selected
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline">
                    Export selected
                  </Button>
                  <Button size="sm" variant="outline">
                    Flag for audit
                  </Button>
                </div>
              </div>
            ) : null}
            {filteredTransactions.length === 0 ? (
              <EmptyState
                title="No transactions in this window"
                description="Your attendance, study sessions, and adjustments will appear here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all visible transactions"
                        className={dashboardTableCheckboxClassName}
                        checked={allTransactionsSelected}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setSelectedTransactionIds((previous) => [
                              ...new Set([...previous, ...transactionIds]),
                            ]);
                            return;
                          }
                          setSelectedTransactionIds((previous) =>
                            previous.filter((id) => !transactionIds.includes(id)),
                          );
                        }}
                      />
                    </TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="w-10">
                        <input
                          type="checkbox"
                          aria-label={`Select ${transaction.description}`}
                          className={dashboardTableCheckboxClassName}
                          checked={selectedTransactionIds.includes(transaction.id)}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedTransactionIds((previous) => [
                                ...new Set([...previous, transaction.id]),
                              ]);
                              return;
                            }
                            setSelectedTransactionIds((previous) =>
                              previous.filter((id) => id !== transaction.id),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell
                        className={
                          transaction.amount >= 0
                            ? "font-semibold text-emerald-700"
                            : "font-semibold text-destructive"
                        }
                      >
                        {transaction.amount >= 0 ? `+${transaction.amount}` : transaction.amount}
                      </TableCell>
                      <TableCell>{transaction.category}</TableCell>
                      <TableCell>{transaction.description}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
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
    </div>
  );
}
