"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { FlaggedGlyph } from "@/components/points/points-glyphs";
import {
  memberFallbackLabel,
  ORG_POINTS_DEFAULTS,
  useMemberDisplayNames,
  useOrgConfig,
  usePointsTransactions,
} from "@repo/hooks";
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
import { amountToneClassName } from "@/components/points/amount-tone";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
} from "@/components/shared/nested-states";
import { PermissionsOfflineSurface } from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { formatLocaleDateTime as formatTimestamp } from "@repo/formatting";

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

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function PointsAuditCard() {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | Category>("ALL");
  const [userFilter, setUserFilter] = useState<string>("ALL");

  // The display roster, not `useMembers`: this card needs a name per row and a
  // name per filter option, and `GET /v1/members` would put every member's
  // email, bio, graduation year, city and company on the wire for anyone who
  // opens /points — this card renders above its own `points:view_all` gate, so
  // that fetch was unconditional (#1000, #986). The leaderboard on this page
  // reads the same hook and the same cache key, so /points issues one request
  // for both rather than the two it used to.
  //
  // `nameFor` also replaces a local map with a `?? "Unnamed member"` default:
  // `display_name` is `NOT NULL DEFAULT ''`, and `??` passes the empty string
  // straight through, so a member who never set a name rendered a blank label.
  const { byId, nameFor } = useMemberDisplayNames();
  // One subscription, not two: `useMemberDisplayNames` already reads the roster,
  // and its map's keys are the same member ids the filter needs.
  const memberIds = useMemo(() => Object.keys(byId), [byId]);

  // #394 — the two anti-fraud limits are chapter-configurable, so this
  // description states what the chapter actually enforces rather than the
  // "±100 points" it used to hardcode. Falls back to the documented defaults
  // while the config query is in flight, or if it fails: those are exactly
  // what an unconfigured chapter enforces, so the fallback is never a guess.
  const orgConfig = useOrgConfig();
  const pointsPolicy = orgConfig.data?.points ?? ORG_POINTS_DEFAULTS;

  const transactionsQuery = usePointsTransactions({
    userId: userFilter === "ALL" ? undefined : userFilter,
    category: categoryFilter === "ALL" ? undefined : categoryFilter,
    flagged: flaggedOnly ? true : undefined,
    limit: 100,
  });

  return (
    <Can
      permission="points:view_all"
      offlineFallback={(retry) => (
        <PermissionsOfflineSurface
          description="Reconnect to check whether you can view the chapter's transaction log."
          onRetry={retry}
        />
      )}
      deniedFallback={
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FlaggedGlyph className="h-5 w-5 text-muted-foreground" />
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
              <FlaggedGlyph className="h-5 w-5 text-muted-foreground" />
              Audit tab
            </CardTitle>
            <CardDescription>
              Chapter-wide point transactions with optional flagged-only filter.
              Flags are raised automatically when a single adjustment reaches ±
              {pointsPolicy.anomaly_threshold} points. One admin may make up to{" "}
              {pointsPolicy.adjustment_rate_limit_per_hour} adjustments per
              hour. Both limits are set in Settings.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={flaggedOnly ? "default" : "secondary"}
              size="sm"
              onClick={() => setFlaggedOnly((prev) => !prev)}
              aria-pressed={flaggedOnly}
              className="gap-2"
            >
              <AlertTriangle className="h-4 w-4" />
              {flaggedOnly ? "Showing flagged only" : "Show flagged only"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void transactionsQuery.refetch()}
              disabled={transactionsQuery.isFetching}
              aria-label="Refresh audit list"
            >
              <RefreshCw
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
                {memberIds.map((userId) => (
                  <SelectItem key={userId} value={userId}>
                    {nameFor(userId) ?? memberFallbackLabel(userId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {transactionsQuery.isPending ? (
            <NestedLoading message="Loading audit transactions..." />
          ) : transactionsQuery.isError ? (
            <NestedError
              title="Audit unavailable"
              description="Couldn't load chapter transactions. Retry or confirm your points:view_all access."
              onRetry={() => void transactionsQuery.refetch()}
            />
          ) : (
            (() => {
              const rows = asArray<TransactionRow>(transactionsQuery.data);
              if (rows.length === 0) {
                return (
                  <NestedEmpty
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
                <ul className="divide-y divide-border">
                  {rows.map((row) => {
                    const flagged = row.metadata?.flagged === true;
                    // The full id, not `memberFallbackLabel`, and deliberately
                    // unlike the leaderboard: this is the audit record, where a
                    // uuid is the operator's handle for a support ticket or a
                    // direct lookup. It is the one surface on /points that still
                    // shows one, which is what the leaderboard's pasted-id
                    // search exists to receive.
                    const name = row.user_id
                      ? nameFor(String(row.user_id)) ?? String(row.user_id)
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
                            <Badge variant="outline">{row.category ?? "UNKNOWN"}</Badge>
                            {flagged ? (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Flagged
                              </Badge>
                            ) : null}
                          </div>
                          {row.description ? (
                            <p className="truncate text-[12.5px] text-muted-foreground">
                              {row.description}
                            </p>
                          ) : null}
                          <p className="text-[12.5px] text-muted-foreground">
                            {formatTimestamp(row.created_at)}
                          </p>
                        </div>
                        <span
                          className={amountToneClassName(row.amount ?? 0, "sm")}
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
