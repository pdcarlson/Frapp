"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Flag, RefreshCcw } from "lucide-react";
import { useMembers, usePointsTransactions } from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";

type Category = "ATTENDANCE" | "ACADEMIC" | "SERVICE" | "FINE" | "MANUAL" | "STUDY";

type TransactionRow = {
  id?: string;
  user_id?: string;
  amount?: number;
  category?: Category;
  description?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

type MemberSummary = {
  user_id?: string;
  display_name?: string | null;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export function PointsAuditCard() {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | Category>("ALL");
  const [userFilter, setUserFilter] = useState<string>("ALL");

  const membersQuery = useMembers();
  const members = useMemo(
    () => asArray<MemberSummary>(membersQuery.data),
    [membersQuery.data],
  );
  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      if (member.user_id) {
        map.set(String(member.user_id), member.display_name ?? "Unnamed member");
      }
    }
    return map;
  }, [members]);

  const transactionsQuery = usePointsTransactions({
    userId: userFilter === "ALL" ? undefined : userFilter,
    category: categoryFilter === "ALL" ? undefined : categoryFilter,
    flagged: flaggedOnly ? true : undefined,
    limit: 100,
  });

  return (
    <Can
      permission="points:view_all"
      deniedFallback={
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Flag className="h-4 w-4 text-muted-foreground" />
              Audit tab
            </CardTitle>
            <CardDescription>
              Viewing the full chapter transaction log requires the
              <code className="mx-1">points:view_all</code>
              permission. Ask your chapter president to grant it if you need
              audit visibility.
            </CardDescription>
          </CardHeader>
        </Card>
      }
    >
      <Card className="border-border">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Flag className="h-4 w-4 text-muted-foreground" />
              Audit tab
            </CardTitle>
            <CardDescription>
              Chapter-wide point transactions with optional flagged-only filter.
              Flags are raised automatically when a single adjustment exceeds
              ±100 points.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={flaggedOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setFlaggedOnly((prev) => !prev)}
              aria-pressed={flaggedOnly}
              className="gap-2"
            >
              <AlertTriangle className="h-4 w-4" />
              {flaggedOnly ? "Showing flagged only" : "Show flagged only"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void transactionsQuery.refetch()}
              disabled={transactionsQuery.isFetching}
              aria-label="Refresh audit list"
            >
              <RefreshCcw
                className={
                  transactionsQuery.isFetching
                    ? "h-4 w-4 animate-spin"
                    : "h-4 w-4"
                }
              />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              value={categoryFilter}
              onValueChange={(value) =>
                setCategoryFilter(value as "ALL" | Category)
              }
            >
              <SelectTrigger aria-label="Filter audit by category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                <SelectItem value="ATTENDANCE">Attendance</SelectItem>
                <SelectItem value="STUDY">Study</SelectItem>
                <SelectItem value="SERVICE">Service</SelectItem>
                <SelectItem value="ACADEMIC">Academic</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
                <SelectItem value="FINE">Fine</SelectItem>
              </SelectContent>
            </Select>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger aria-label="Filter audit by member">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All members</SelectItem>
                {members.map((member) => (
                  <SelectItem
                    key={member.user_id ?? "unknown"}
                    value={String(member.user_id ?? "")}
                  >
                    {member.display_name ?? "Unnamed member"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {transactionsQuery.isPending ? (
            <LoadingState message="Loading audit transactions..." />
          ) : transactionsQuery.isError ? (
            <ErrorState
              title="Audit unavailable"
              description="Couldn't load chapter transactions. Retry or confirm your points:view_all access."
              onRetry={() => void transactionsQuery.refetch()}
            />
          ) : (
            (() => {
              const rows = asArray<TransactionRow>(transactionsQuery.data);
              if (rows.length === 0) {
                return (
                  <EmptyState
                    title={
                      flaggedOnly
                        ? "No flagged transactions in this window"
                        : "No transactions match this filter"
                    }
                    description={
                      flaggedOnly
                        ? "Large single adjustments (|amount| ≥ 100) will appear here automatically."
                        : "Try relaxing the category or member filter."
                    }
                  />
                );
              }
              return (
                <ul className="divide-y divide-border/70">
                  {rows.map((row) => {
                    const flagged = row.metadata?.flagged === true;
                    const name = row.user_id
                      ? memberNameById.get(String(row.user_id)) ??
                        String(row.user_id)
                      : "Unknown member";
                    const sign = (row.amount ?? 0) >= 0 ? "+" : "";
                    return (
                      <li
                        key={row.id}
                        className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">{name}</span>
                            <Badge variant={flagged ? "destructive" : "outline"}>
                              {row.category ?? "UNKNOWN"}
                            </Badge>
                            {flagged ? (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Flagged
                              </Badge>
                            ) : null}
                          </div>
                          {row.description ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {row.description}
                            </p>
                          ) : null}
                          <p className="text-[11px] text-muted-foreground">
                            {formatTimestamp(row.created_at)}
                          </p>
                        </div>
                        <span
                          className={
                            (row.amount ?? 0) >= 0
                              ? "text-sm font-semibold text-emerald-700"
                              : "text-sm font-semibold text-destructive"
                          }
                        >
                          {sign}
                          {row.amount ?? 0} points
                        </span>
                      </li>
                    );
                  })}
                </ul>
              );
            })()
          )}
        </CardContent>
      </Card>
    </Can>
  );
}
