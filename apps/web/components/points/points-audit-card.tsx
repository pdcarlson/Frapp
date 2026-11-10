"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { FlaggedGlyph } from "@/components/points/points-glyphs";
import {
  memberFallbackLabel,
  ORG_POINTS_DEFAULTS,
  useMemberDisplayNames,
  useOrgConfig,
  usePointsTransactions,
} from "@repo/hooks";
import { formatDayTime, formatTimestampFull } from "@repo/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { amountToneClassName } from "@/components/points/amount-tone";
import {
  POINT_CATEGORIES,
  pointCategoryLabel,
  type PointCategory,
} from "@/components/points/point-category";
import { NestedError, NestedLoading } from "@/components/shared/nested-states";
import { PermissionsOfflineSurface } from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { SectionLabel } from "@/components/shared/section-label";
import {
  dashboardToolbarHeightClassName,
  denseListClassName,
} from "@/components/shared/table-controls";
import { asArray, cn } from "@/lib/utils";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";

type Category = PointCategory;

/**
 * The Radix filter triggers at the toolbar height. `SelectTrigger` is a form
 * field at 40 (44 to a finger) by default; in this section's toolbar row it lines up with the
 * buttons beside it instead.
 */
const TOOLBAR_SELECT = `${dashboardToolbarHeightClassName} w-full text-sm @xl:w-44`;

/** The square refresh control at the toolbar height: 36, or 44 to a finger. */
const TOOLBAR_ICON = `${dashboardToolbarHeightClassName} w-9 pointer-coarse:w-11`;

type TransactionRow = {
  id?: string;
  user_id?: string;
  amount?: number;
  category?: Category;
  description?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

type AuditPaging = {
  before: string | undefined;
  history: Array<string | undefined>;
};

export const AUDIT_PAGE_SIZE = 100;

/**
 * Cursor for the next (older) page: the oldest `created_at` on a full page,
 * returned **verbatim**. The API compares with `created_at < before`, and
 * Postgres `timestamptz` is microsecond; running this through `Date` drops
 * the last three digits and can skip a same-millisecond sibling (#1832 / #1480).
 *
 * A short page, or a full page whose oldest row has no `created_at`, means
 * there is nothing further to request.
 */
export function olderAuditCursor(
  rows: readonly Pick<TransactionRow, "created_at">[],
  pageSize: number = AUDIT_PAGE_SIZE,
): string | undefined {
  if (rows.length < pageSize) return undefined;
  const oldest = rows[rows.length - 1]?.created_at;
  return typeof oldest === "string" && oldest.length > 0 ? oldest : undefined;
}

const INITIAL_PAGING: AuditPaging = { before: undefined, history: [] };

export function PointsAuditCard() {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | Category>("ALL");
  const [userFilter, setUserFilter] = useState<string>("ALL");
  const [paging, setPaging] = useState<AuditPaging>(INITIAL_PAGING);

  // The display roster, not `useMembers`: this card needs a name per row and a
  // name per filter option, and `GET /v1/members` would put every member's
  // email, bio, graduation year, city and company on the wire for anyone who
  // opens /points — this card renders above its own `points:view_all` gate, so
  // that fetch was unconditional (#1000, #986). The leaderboard on this page
  // reads the same hook and the same cache key, so /points issues one request
  // for both rather than the two it used to.
  //
  // `nameFor` also replaces a local map with a hand-written `??` default:
  // `display_name` is `NOT NULL DEFAULT ''`, and `??` passes the empty string
  // straight through, so a member who never set a name rendered a blank label.
  const { byId, nameFor } = useMemberDisplayNames();
  // One subscription, not two: `useMemberDisplayNames` already reads the roster,
  // and its map's keys are the same member ids the filter needs.
  const memberIds = useMemo(() => Object.keys(byId), [byId]);

  // #394 — the two anti-fraud limits are chapter-configurable, so the
  // section's state line states what the chapter actually enforces rather than the
  // "±100 points" it used to hardcode. Falls back to the documented defaults
  // while the config query is in flight, or if it fails: those are exactly
  // what an unconfigured chapter enforces, so the fallback is never a guess.
  //
  // Merged field-by-field rather than `?? DEFAULTS`: `applyOptimistic` can
  // write a partial `points` into the cache after a single-dial PATCH, and an
  // object-level fallback would then render a blank where a number belongs.
  //
  // `isSuccess` gates the line because this section renders for roles that
  // cannot read the config at all — the seeded Treasurer holds points:view_all
  // but not chapter-config:view, so GET /config 403s and `data` is undefined.
  // Stating the defaults as this chapter's policy would be a guess, and a
  // confident wrong number about a fraud limit is worse than no number.
  const orgConfig = useOrgConfig();
  const pointsPolicy = { ...ORG_POINTS_DEFAULTS, ...orgConfig.data?.points };
  const policyKnown = orgConfig.isSuccess;

  const transactionsQuery = usePointsTransactions({
    userId: userFilter === "ALL" ? undefined : userFilter,
    category: categoryFilter === "ALL" ? undefined : categoryFilter,
    flagged: flaggedOnly ? true : undefined,
    before: paging.before,
    limit: AUDIT_PAGE_SIZE,
  });

  const rows = asArray<TransactionRow>(transactionsQuery.data);
  const olderCursor = olderAuditCursor(rows);
  const canGoNewer = paging.history.length > 0;
  const canGoOlder = olderCursor !== undefined;

  function resetPaging() {
    setPaging(INITIAL_PAGING);
  }

  function goOlder(createdAt: string) {
    setPaging((current) => ({
      before: createdAt,
      history: [...current.history, current.before],
    }));
  }

  function goNewer() {
    setPaging((current) => {
      if (current.history.length === 0) return current;
      return {
        before: current.history[current.history.length - 1],
        history: current.history.slice(0, -1),
      };
    });
  }

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
        // Labelled as the section is when it renders, with one caption saying
        // why the list is missing: a card here would draw the section's title
        // in a second style beside the page's flush sections.
        <section aria-labelledby="points-audit-label" className="space-y-1">
          <SectionLabel id="points-audit-label">Audit</SectionLabel>
          <p className="text-sm text-muted-foreground">
            Your role can&apos;t see every transaction.
          </p>
        </section>
      }
    >
      <section aria-labelledby="points-audit-label" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 space-y-0.5">
            <SectionLabel id="points-audit-label">Audit</SectionLabel>
            {/*
              State, not policy narration: the two limits this chapter
              enforces right now, then the one fact a moved threshold makes
              visible. A flag is written when the adjustment lands and never
              re-checked (`spec/behavior/points.md` § Anti-Fraud), so after a
              chapter moves the dial the list holds rows the current line
              wouldn't flag. Omitted rather than guessed when the config is
              unreadable (see `policyKnown` above).
            */}
            {policyKnown ? (
              <p className="text-caption text-muted-foreground">
                {`Flags at ±${pointsPolicy.anomaly_threshold} points · ${pointsPolicy.adjustment_rate_limit_per_hour} adjustments per admin per hour`}
                <span className="block">
                  Each flag keeps the threshold it was raised under.
                </span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={categoryFilter}
              onValueChange={(value) => {
                setCategoryFilter(value as "ALL" | Category);
                resetPaging();
              }}
            >
              <SelectTrigger
                aria-label="Filter audit by category"
                className={TOOLBAR_SELECT}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {POINT_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {pointCategoryLabel(category)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={userFilter}
              onValueChange={(value) => {
                setUserFilter(value);
                resetPaging();
              }}
            >
              <SelectTrigger
                aria-label="Filter audit by member"
                className={TOOLBAR_SELECT}
              >
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
            {/*
              A toggle, so its label stays put and `aria-pressed` carries the
              state. On, it takes the accent tint rather than the solid fill:
              a filter is never the row's primary action.
            */}
            <Button
              variant={flaggedOnly ? "tinted" : "secondary"}
              size="toolbar"
              onClick={() => {
                setFlaggedOnly((prev) => !prev);
                resetPaging();
              }}
              aria-pressed={flaggedOnly}
              className="gap-2"
            >
              <FlaggedGlyph className="h-4 w-4" active={flaggedOnly} />
              Flagged only
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={TOOLBAR_ICON}
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
        </div>

        {transactionsQuery.isPending ? (
          <NestedLoading message="Loading audit transactions..." />
        ) : (
          <>
            {transactionsQuery.isError ? (
              <NestedError
                title="Audit unavailable"
                description={`Couldn't load chapter transactions. ${describeLoadFailure(transactionsQuery.error)}`}
                onRetry={() => void transactionsQuery.refetch()}
              />
            ) : rows.length === 0 ? (
              flaggedOnly ? (
                <InlineNote>
                  {policyKnown
                    ? `Nothing flagged in this window. Single adjustments of |amount| ≥ ${pointsPolicy.anomaly_threshold} land here.`
                    : "Nothing flagged in this window."}
                </InlineNote>
              ) : (
                <InlineNote>
                  No transactions match these filters.{" "}
                  <InlineNoteAction
                    onClick={() => {
                      setCategoryFilter("ALL");
                      setUserFilter("ALL");
                    }}
                  >
                    Clear filters
                  </InlineNoteAction>
                </InlineNote>
              )
            ) : (
              // `role="list"` restated: a flex `<li>` loses its `list-item`
              // box, and WebKit then stops exposing the list semantics.
              <ul role="list" className={denseListClassName}>
                {rows.map((row) => {
                  const flagged = row.metadata?.flagged === true;
                  // The full id, not `memberFallbackLabel`, and deliberately
                  // unlike the leaderboard: this is the audit record, where a
                  // uuid is the operator's handle for a support ticket or a
                  // direct lookup. It is the one surface on /points that still
                  // shows one, which is what the leaderboard's pasted-id
                  // search exists to receive.
                  const name = row.user_id
                    ? (nameFor(String(row.user_id)) ?? String(row.user_id))
                    : "Unknown member";
                  const amount = row.amount ?? 0;
                  const sign = amount >= 0 ? "+" : "";
                  const categoryLabel = pointCategoryLabel(row.category);
                  const when = formatDayTime(row.created_at);
                  // One `·`-joined meta line, bounded facts first and the
                  // free-text reason last, so truncation eats the reason. An
                  // absent fact drops out of the line.
                  const meta: Array<{ key: string; node: ReactNode }> = [];
                  if (categoryLabel) {
                    meta.push({ key: "category", node: categoryLabel });
                  }
                  if (when) {
                    meta.push({
                      key: "when",
                      node: (
                        <time
                          dateTime={row.created_at}
                          title={
                            formatTimestampFull(row.created_at) ?? undefined
                          }
                        >
                          {when}
                        </time>
                      ),
                    });
                  }
                  if (row.description) {
                    meta.push({ key: "reason", node: row.description });
                  }
                  return (
                    <li
                      key={row.id}
                      className="flex min-h-11 flex-col gap-0.5 py-2 @xl:flex-row @xl:items-center @xl:gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                            {name}
                          </span>
                          {flagged ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Flagged
                            </Badge>
                          ) : null}
                        </div>
                        {meta.length > 0 ? (
                          <p className="truncate text-caption text-muted-foreground">
                            {meta.map((part, index) => (
                              <span key={part.key}>
                                {index > 0 ? " · " : null}
                                {part.node}
                              </span>
                            ))}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          amountToneClassName(amount, "sm"),
                          "shrink-0 @xl:text-right",
                        )}
                      >
                        {`${sign}${amount} points`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {canGoNewer || canGoOlder ? (
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="secondary"
                  size="toolbar"
                  disabled={!canGoNewer || transactionsQuery.isFetching}
                  onClick={goNewer}
                >
                  Newer transactions
                </Button>
                <Button
                  variant="secondary"
                  size="toolbar"
                  disabled={!canGoOlder || transactionsQuery.isFetching}
                  onClick={() => {
                    if (olderCursor !== undefined) goOlder(olderCursor);
                  }}
                >
                  Older transactions
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </Can>
  );
}
