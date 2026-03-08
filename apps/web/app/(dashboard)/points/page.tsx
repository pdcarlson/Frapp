"use client";

import { useState } from "react";
import { useLeaderboard, useMyPoints } from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingState } from "@/components/shared/async-states";

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
  const leaderboardQuery = useLeaderboard(window);
  const summaryQuery = useMyPoints(window);
  const usingPreviewData = leaderboardQuery.isError || summaryQuery.isError;

  const isLoading = leaderboardQuery.isLoading || summaryQuery.isLoading;

  const leaderboard = usingPreviewData
    ? fallbackLeaderboard
    : Array.isArray(leaderboardQuery.data)
      ? (leaderboardQuery.data as LeaderboardRow[])
      : [];

  const summary = summaryQuery.data as
    | { balance?: number; transactions?: PointTransactionRow[] }
    | undefined;
  const transactions = usingPreviewData
    ? fallbackTransactions
    : Array.isArray(summary?.transactions)
      ? summary.transactions
      : [];

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
            {leaderboard.length === 0 ? (
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
                  {leaderboard.map((entry, index) => (
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
            {transactions.length === 0 ? (
              <EmptyState
                title="No transactions in this window"
                description="Your attendance, study sessions, and adjustments will appear here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Amount</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((transaction) => (
                    <TableRow key={transaction.id}>
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
