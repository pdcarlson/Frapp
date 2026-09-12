"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  InviteGlyph,
  SearchGlyph,
} from "@/components/members/directory-glyphs";
import {
  useLeaderboard,
  useMemberSearch,
  useMembers,
  useRoles,
  useUpdateMemberRoles,
  useOrgConfig,
} from "@repo/hooks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EYEBROW } from "@/components/ui/typography";
import { anyReadUncached } from "@/components/shared/async-states";
/*
  The **nested** state family, not the whole-screen one, and on a page with no
  cards left that is the point rather than a technicality. `EmptyState` and its
  siblings paint `--card`; this lane just deleted the three `<Card>`s on this
  route, so rendering one would put the card back through the door the lane
  closed. `elevation-contrast.spec.ts` argues the same side from the other end —
  a hairline over an unfilled surface separates better than a `--card` panel's
  does, and its docblock names that assertion as "the one that should fail if
  someone restores the Card for consistency". Lane 4 moved `/documents` and
  `/backwork` across for this reason; this is the same move on the same grounds.

  `sole` on every one of them: each is the whole screen's only async state, so
  the loading skeleton needs its live region back and the titles need to be
  headings rather than paragraphs.
*/
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
  NestedOffline,
} from "@/components/shared/nested-states";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
  denseListClassName,
} from "@/components/shared/table-controls";
import { useToast } from "@/hooks/use-toast";
import { InviteMemberDialog } from "@/components/members/invite-member-dialog";
import { MemberDetailSheet } from "@/components/members/member-detail-sheet";
import { useNetwork } from "@/lib/providers/network-provider";
import { AvatarPresenceDot } from "@/components/members/presence-dot";
import { useChapterPresenceContext } from "@/lib/providers/chapter-presence-provider";
import {
  presenceLabel,
  type PresenceStatus,
} from "@/lib/realtime/presence-status";
import { vocab } from "@/lib/vocabulary";
import { asArray, cn, initials } from "@/lib/utils";
import { stateMicrocopy } from "@/lib/state-microcopy";

const PAGE_SIZE = 25;

type MemberRow = {
  id: string;
  user_id: string;
  chapter_id: string;
  role_ids: string[];
  has_completed_onboarding: boolean;
  created_at: string;
  updated_at: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  graduation_year: number | null;
  current_city: string | null;
  current_company: string | null;
  email: string;
};

type RoleOption = { id: string; name: string; isPresident: boolean };

type SortKey = "name" | "role" | "points" | "joined";
type SortDir = "asc" | "desc";

/**
 * Sorting, as one control rather than four sortable column headers.
 *
 * The table this list replaces carried a `SortableHead` button in each of four
 * `<th>`s, which is the densest place to put sorting *in a table* and has no
 * home at all in a flat list — the board's list rows (`4a`) have no header row
 * to hang one on, and `1f` pin 2 gives a route one toolbar row holding "filter
 * menu, view toggle, primary action". So the eight reachable (key, direction)
 * pairs become eight options on one select that sits with the filters, and no
 * direction state has to be inferred from a second click on the same header.
 *
 * All eight pairs are listed rather than the four keys plus a direction toggle:
 * the toggle would be a ninth control in the row, and "Role Z to A" is cheaper
 * to read than an arrow glyph whose meaning depends on which column is active.
 */
const SORT_OPTIONS = [
  { value: "name:asc", label: "Name A to Z" },
  { value: "name:desc", label: "Name Z to A" },
  { value: "role:asc", label: "Role A to Z" },
  { value: "role:desc", label: "Role Z to A" },
  { value: "points:desc", label: "Most points" },
  { value: "points:asc", label: "Fewest points" },
  { value: "joined:desc", label: "Newest first" },
  { value: "joined:asc", label: "Oldest first" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

const DEFAULT_SORT: SortValue = "name:asc";

function parseSort(value: SortValue): { key: SortKey; dir: SortDir } {
  const [key, dir] = value.split(":");
  return { key: key as SortKey, dir: dir as SortDir };
}

function memberId(member: MemberRow): string {
  return String(member.id ?? member.user_id ?? "");
}

function displayNameOf(member: MemberRow): string {
  return typeof member.display_name === "string" &&
    member.display_name.length > 0
    ? member.display_name
    : `Member ${String(member.user_id ?? "").slice(0, 8)}`;
}

/**
 * `null` rather than an em dash for a date that will not parse.
 *
 * Board `1t` lists "em dashes in UI copy" under gone, and the replacement is
 * not a different dash: a row's meta line is a `·`-joined list of the facts
 * that exist (the shape lane 4 landed on `/documents`), so a fact that is
 * missing is simply absent from the line. A placeholder glyph is a character a
 * screen reader has to announce standing in for nothing at all.
 */
function formatJoined(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/**
 * The actives half of the Directory.
 *
 * **Flat, not carded.** Three `<Card>`s used to stack here — a search-and-filter
 * card, a conditional bulk-actions card and a results card wrapping the table —
 * and between them they paid three hairlines, three sets of 24px padding and
 * two title blocks whose job was to name a list the member was already looking
 * at. Board `1t` names the same stack one route over ("Events: header card,
 * description, filter card, table card, … card title, checkbox column — gone")
 * and `1f` pin 2 gives a route's body one toolbar row with "no wrapper card, no
 * description paragraph". What survives of each card is its heading, as the
 * `EYEBROW` section label above a flush list — the grammar lane 4 landed on
 * `/documents` and `/backwork`.
 *
 * **The rows are the board's member row, not its table row.** `4a` draws the
 * only member row in the file at 34px with a 24px avatar, a 10px gap and the
 * name on one truncating line; `4d`'s 40px data row is a plan matrix. 34 is not
 * a Tailwind step and `min-h-9` (36) is the adjacent one, so the row is
 * `min-h-9` with `pointer-coarse:min-h-11` restoring §2's 44px floor on touch —
 * the same carve-out `denseRowControlClassName` and lane 4's folder rail take,
 * and the reading §2 spells out ("compact 34px controls are web/pointer-only").
 * It is deliberately *not* lane 4's flat `min-h-11` document row: that row is
 * not itself a control, where this one is the member's whole hit target, and
 * the lane's own density target is 32–36 on a pointer.
 */
export function MembersDirectory() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [cohortFilter, setCohortFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "pending"
  >("all");
  const [sort, setSort] = useState<SortValue>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [bulkRoleId, setBulkRoleId] = useState<string>("");
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  const { key: sortKey, dir: sortDir } = parseSort(sort);
  const trimmedQuery = query.trim();
  // Keeps typing responsive without a debounce timer of our own: the query only
  // re-runs once React has caught up with the keystrokes. Matches the mobile
  // directory screen's guard against firing a request per keystroke.
  const deferredQuery = useDeferredValue(trimmedQuery);
  const membersQuery = useMembers();
  const searchQuery = useMemberSearch(deferredQuery);
  const rolesQuery = useRoles();
  const leaderboardQuery = useLeaderboard();
  const orgConfig = useOrgConfig();
  const updateRolesMutation = useUpdateMemberRoles();
  // Presence is chapter-wide and ephemeral (ADR-02) — it rides the Realtime
  // socket and touches no table, so this adds no query and no write. The
  // subscription is owned by the dashboard shell, not by this screen: a member
  // is present because the app is open, not because they are on this page.
  const presence = useChapterPresenceContext();
  const usingSearch = deferredQuery.length > 0;
  const activeQuery = usingSearch ? searchQuery : membersQuery;

  const members = useMemo(() => {
    const raw = activeQuery.data;
    return Array.isArray(raw) ? (raw as MemberRow[]) : [];
  }, [activeQuery.data]);

  const roleOptions = useMemo<RoleOption[]>(() => {
    return asArray<Record<string, unknown>>(rolesQuery.data).flatMap((role) => {
      if (!role || typeof role !== "object") return [];
      if (typeof role.id !== "string" || typeof role.name !== "string")
        return [];
      // The President role carries the wildcard (`*`) permission. `PATCH
      // /members/:id/roles` rejects president changes (they go through the
      // dedicated presidency-transfer flow), so flag it to keep it out of the
      // bulk-assign dropdown below.
      const permissions = Array.isArray(role.permissions)
        ? role.permissions
        : [];
      const isPresident = role.is_system === true && permissions.includes("*");
      return [{ id: role.id, name: role.name, isPresident }];
    });
  }, [rolesQuery.data]);
  const roleNameById = useMemo(
    () => new Map(roleOptions.map((role) => [role.id, role.name])),
    [roleOptions],
  );
  // Bulk role assignment can't set the President role — the endpoint rejects it
  // — so offering it would guarantee a failing action. It stays available in the
  // filter dropdown (filtering by President is valid); only assignment excludes it.
  const assignableRoleOptions = useMemo(
    () => roleOptions.filter((role) => !role.isPresident),
    [roleOptions],
  );

  const pointsByUserId = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of asArray<Record<string, unknown>>(
      leaderboardQuery.data,
    )) {
      if (
        typeof entry.user_id === "string" &&
        typeof entry.total === "number"
      ) {
        map.set(entry.user_id, entry.total);
      }
    }
    return map;
  }, [leaderboardQuery.data]);

  const cohortTerm = vocab("class", orgConfig.data);
  // Cohort options come from the full roster (not the search-narrowed list) so a
  // selected cohort never silently loses its <option> mid-search.
  const cohortOptions = useMemo(() => {
    const years = new Set<number>();
    for (const member of asArray<MemberRow>(membersQuery.data)) {
      if (typeof member.graduation_year === "number")
        years.add(member.graduation_year);
    }
    return [...years].sort((a, b) => b - a);
  }, [membersQuery.data]);

  const pointsOf = (member: MemberRow) =>
    pointsByUserId.get(member.user_id) ?? 0;
  // `null` until presence has resolved for this chapter — the dot renders
  // nothing rather than claiming Offline, which would be a statement about the
  // member sourced from our own unfinished join.
  const presenceStatusOf = (member: MemberRow): PresenceStatus | null =>
    presence.isReady ? presence.statusOf(member.user_id) : null;
  // `null`, not an em dash, for the same reason `formatJoined` returns one: an
  // absent role drops out of the `·`-joined meta line rather than rendering a
  // placeholder glyph.
  const primaryRoleName = (member: MemberRow): string | null => {
    const firstId = Array.isArray(member.role_ids)
      ? member.role_ids[0]
      : undefined;
    if (!firstId) return null;
    return roleNameById.get(firstId) ?? firstId;
  };

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      if (
        roleFilter !== "all" &&
        !(member.role_ids ?? []).includes(roleFilter)
      ) {
        return false;
      }
      if (
        cohortFilter !== "all" &&
        String(member.graduation_year ?? "") !== cohortFilter
      ) {
        return false;
      }
      if (statusFilter === "active" && !member.has_completed_onboarding)
        return false;
      if (statusFilter === "pending" && member.has_completed_onboarding)
        return false;
      return true;
    });
  }, [members, roleFilter, cohortFilter, statusFilter]);

  const sortedMembers = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    return [...filteredMembers].sort((a, b) => {
      switch (sortKey) {
        case "points":
          return (pointsOf(a) - pointsOf(b)) * factor;
        case "joined":
          return (
            (new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()) *
            factor
          );
        case "role":
          // Members with no role sort last in either direction rather than
          // under an empty string, which would put them above every named role
          // ascending and below it descending for no reason a reader can see.
          return (
            (primaryRoleName(a) ?? "￿").localeCompare(
              primaryRoleName(b) ?? "￿",
            ) * factor
          );
        case "name":
        default:
          return displayNameOf(a).localeCompare(displayNameOf(b)) * factor;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredMembers, sortKey, sortDir, pointsByUserId, roleNameById]);

  const pageCount = Math.max(1, Math.ceil(sortedMembers.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageMembers = useMemo(
    () =>
      sortedMembers.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE,
      ),
    [sortedMembers, currentPage],
  );

  // Changing the filter set or search swaps the visible population, so reset to
  // the first page and drop any selection/bulk-role draft — otherwise the
  // selection bar would keep counting members that are no longer shown.
  /* eslint-disable react-hooks/set-state-in-effect -- reset paging/selection when the visible member set changes */
  useEffect(() => {
    setPage(1);
    setSelectedMemberIds([]);
    setBulkRoleId("");
  }, [trimmedQuery, roleFilter, cohortFilter, statusFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Re-sorting keeps the same population; just return to the first page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- return to page 1 when sort identity changes
    setPage(1);
  }, [sort]);

  const pageMemberIds = pageMembers.map(memberId);
  const allPageSelected =
    pageMemberIds.length > 0 &&
    pageMemberIds.every((id) => selectedMemberIds.includes(id));
  const selectedCount = selectedMemberIds.length;
  const activeMember = useMemo(
    () =>
      sortedMembers.find((member) => memberId(member) === activeMemberId) ??
      null,
    [activeMemberId, sortedMembers],
  );
  // A filter or a search term is the difference between "this chapter has no
  // members" and "nothing matched what you asked for" — two different states on
  // the board (`3b`: "Empty = accent tile + tinted CTA. No results = neutral
  // tile, names the query"), which this surface used to answer with one string
  // that guessed at both.
  const narrowed =
    usingSearch ||
    roleFilter !== "all" ||
    cohortFilter !== "all" ||
    statusFilter !== "all";

  function toggleMember(id: string, isSelected: boolean) {
    setSelectedMemberIds((prev) =>
      isSelected ? [...new Set([...prev, id])] : prev.filter((c) => c !== id),
    );
  }

  function openMember(id: string) {
    setActiveMemberId(id);
    setDetailSheetOpen(true);
  }

  async function applyBulkRole() {
    if (!bulkRoleId || selectedCount === 0) return;
    const targets = sortedMembers.filter(
      (member) =>
        selectedMemberIds.includes(memberId(member)) &&
        !(member.role_ids ?? []).includes(bulkRoleId),
    );
    if (targets.length === 0) {
      toast({
        title: "No changes",
        description: "Every selected member already has that role.",
      });
      return;
    }

    const results = await Promise.allSettled(
      targets.map((member) =>
        updateRolesMutation.mutateAsync({
          id: memberId(member),
          role_ids: [...new Set([...(member.role_ids ?? []), bulkRoleId])],
        }),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    const succeeded = targets.length - failed;
    const roleName = roleNameById.get(bulkRoleId) ?? "role";

    if (failed === 0) {
      toast({
        title: "Role assigned",
        description: `Added ${roleName} to ${succeeded} member${succeeded === 1 ? "" : "s"}.`,
      });
      setSelectedMemberIds([]);
      setBulkRoleId("");
    } else {
      toast({
        title: "Some assignments failed",
        description: `${roleName}: ${succeeded} updated, ${failed} failed. Retry the rest.`,
        variant: "destructive",
      });
    }
  }

  /**
   * Everything that can be *replaced* by an async state.
   *
   * Split out so `<MemberDetailSheet>` can render outside it, and that is a
   * correctness fix rather than tidying. The sheet owns a `useConfirmDialog`
   * promise now (this lane's replacement for `window.confirm` on member
   * removal), and `await confirm(...)` only settles while its host is mounted.
   * With the state branches returning early from the component, a background
   * refetch flipping `rolesQuery` or `leaderboardQuery` to `isError` while the
   * sheet sat at the confirm step would unmount the sheet mid-promise and hang
   * that `await` forever — the same two-change interaction `documents-page.tsx`
   * records against its own confirmation, and the reason it renders its dialog
   * last and unconditionally.
   *
   * The branches themselves are unchanged, deliberately. Lane 4 scopes its
   * states to the list region and keeps its toolbar up; doing that here would
   * leave the search input mounted while offline, which rewrites the recorded
   * reason (#1621) that this screen's Retry clears the search term — that
   * escape exists precisely because the state replaces the input that produced
   * it. Re-deciding it is a resilience change, not a chrome one.
   */
  function renderBody() {
    /*
     * Roles and points are in this gate, not just the member rows, because the
     * two guards below that would otherwise catch them are dead while offline:
     * a paused query is neither `isLoading` nor `isError`. Without them the
     * directory renders every member at 0 points under a raw role UUID, with an
     * empty role filter and meaningless points sorting — which is exactly the
     * "looks healthy while quietly broken" state the comment on those guards
     * exists to prevent.
     */
    if (
      isOffline &&
      anyReadUncached(activeQuery, rolesQuery, leaderboardQuery)
    ) {
      return (
        <NestedOffline
          sole
          title={stateMicrocopy.members.offlineTitle}
          description={stateMicrocopy.members.offlineDescription}
          onRetry={() => {
            /*
             * Clearing the search is part of the retry, not a nicety. Typing
             * offline swaps `activeQuery` to a search key that was never
             * fetched, so this card replaces the directory — including the input
             * that produced the term — while the query state survives. Without
             * this the member has no control left to undo it.
             *
             * Only when the search is actually the uncached read, though: the
             * gate covers three reads, and discarding what they typed to recover
             * from an uncached *roles* fetch would lose their work for nothing.
             */
            if (usingSearch && anyReadUncached(searchQuery)) setQuery("");
            void membersQuery.refetch();
            if (usingSearch) void searchQuery.refetch();
            void rolesQuery.refetch();
            void leaderboardQuery.refetch();
          }}
        />
      );
    }

    if (activeQuery.isLoading) {
      return <NestedLoading sole message={stateMicrocopy.members.loading} />;
    }

    if (activeQuery.isError) {
      return (
        <NestedError
          sole
          title={stateMicrocopy.members.errorTitle}
          description={stateMicrocopy.members.errorDescription}
          onRetry={() => {
            void activeQuery.refetch();
          }}
        />
      );
    }

    // Roles and points underpin the role filter, bulk assignment, the role in
    // each row's meta line and points sorting. If either query fails silently the
    // directory still looks healthy while those features are quietly broken, so
    // surface their load state.
    if (rolesQuery.isLoading || leaderboardQuery.isLoading) {
      return <NestedLoading sole message={stateMicrocopy.members.loading} />;
    }

    if (rolesQuery.isError || leaderboardQuery.isError) {
      return (
        <NestedError
          sole
          title={stateMicrocopy.members.supportErrorTitle}
          description={stateMicrocopy.members.supportErrorDescription}
          onRetry={() => {
            void activeQuery.refetch();
            void rolesQuery.refetch();
            void leaderboardQuery.refetch();
          }}
        />
      );
    }

    return (
      <section aria-labelledby="members-list-label" className="space-y-3">
        {/*
        One toolbar row, not a card header: the list's own name and count on the
        left, its search, filters and sort on the right, sitting directly on the
        page surface. `1f` pin 2.
      */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2
              id="members-list-label"
              className={`${EYEBROW} truncate text-muted-foreground`}
            >
              Actives
            </h2>
            <p className="shrink-0 text-[12.5px] text-muted">
              {sortedMembers.length} member
              {sortedMembers.length === 1 ? "" : "s"}
              {usingSearch ? ` matching “${deferredQuery}”` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/*
            `type="search"`, not `type="text"`: it gets the browser's own clear
            affordance and the correct role. The visible <Label> is `sr-only`
            rather than absent — a placeholder is not an accessible name.

            The top bar's find field (`1b` pin 8) finds members too, but it
            navigates to this route rather than narrowing it, and this input is
            wired to `useMemberSearch` — a server-side search over the whole
            roster, not a filter over the loaded page. Deleting it the way lane
            3 deleted the channels column's field would remove a capability, so
            it stays, as `/documents` and `/backwork` kept theirs.
          */}
            <div className="relative w-full sm:w-56">
              {/*
              "Search members", not "Search by member name": `GET
              /v1/members/search` matches name, email and custom-field values
              (`spec/behavior/members.md`), so naming only the name narrowed the
              control in its own label.
            */}
              <Label htmlFor="member-search" className="sr-only">
                Search members
              </Label>
              <SearchGlyph className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="member-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search members"
                className="h-11 pl-9"
              />
            </div>
            <select
              aria-label="Filter members by role"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className={dashboardFilterSelectClassName}
            >
              <option value="all">Role: All</option>
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>
                  Role: {role.name}
                </option>
              ))}
            </select>
            <select
              aria-label={`Filter members by ${cohortTerm}`}
              value={cohortFilter}
              onChange={(event) => setCohortFilter(event.target.value)}
              className={dashboardFilterSelectClassName}
            >
              <option value="all">{cohortTerm}: All</option>
              {cohortOptions.map((year) => (
                <option key={year} value={String(year)}>
                  {cohortTerm}: {year}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter members by status"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as "all" | "active" | "pending",
                )
              }
              className={dashboardFilterSelectClassName}
            >
              <option value="all">Status: All</option>
              <option value="active">Status: Active</option>
              <option value="pending">Status: Pending</option>
            </select>
            <select
              aria-label="Sort members"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortValue)}
              className={dashboardFilterSelectClassName}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  Sort: {option.label}
                </option>
              ))}
            </select>
            {/*
            The route's primary action, at the trailing edge of the one toolbar
            row `1f` pin 2 describes. It renders above the empty state as well
            as above a populated list, which is what lets the empty state carry
            no CTA of its own without leaving the member nothing to do.
          */}
            <InviteMemberDialog
              trigger={
                <Button className="gap-2">
                  <InviteGlyph className="h-4 w-4" />
                  Invite member
                </Button>
              }
            />
          </div>
        </div>

        {/*
        The selection bar `1f` pin 4 names, in place of the accent-tinted
        `<Card>` that used to stack above the results card. It is a flush tinted
        row rather than a card because the page has no cards left for it to sit
        beside, and it carries the select-all the deleted table header used to
        hold: with the checkbox column gone there is no header row for it, and
        hoisting it into the toolbar would put a permanently visible control
        there for a bulk action most members cannot complete.
      */}
        {selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent-border bg-accent-subtle px-2 py-1.5">
            <p className="text-[12.5px] font-semibold text-accent-text">
              {selectedCount} selected
            </p>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
              <input
                type="checkbox"
                aria-label="Select all members on this page"
                className={dashboardTableCheckboxClassName}
                checked={allPageSelected}
                onChange={(event) => {
                  if (event.target.checked) {
                    setSelectedMemberIds((prev) => [
                      ...new Set([...prev, ...pageMemberIds]),
                    ]);
                    return;
                  }
                  setSelectedMemberIds((prev) =>
                    prev.filter((id) => !pageMemberIds.includes(id)),
                  );
                }}
              />
              All on this page
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <select
                aria-label="Select role to assign"
                value={bulkRoleId}
                onChange={(event) => setBulkRoleId(event.target.value)}
                className={dashboardFilterSelectClassName}
              >
                <option value="">Assign role</option>
                {assignableRoleOptions.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => void applyBulkRole()}
                disabled={!bulkRoleId || updateRolesMutation.isPending}
              >
                Apply
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSelectedMemberIds([]);
                  setBulkRoleId("");
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        ) : null}

        {sortedMembers.length === 0 ? (
          /*
           * Three states where there was one, because the board draws them as
           * three: "Empty = accent tile + tinted CTA. No results = neutral tile,
           * names the query." The string this replaced ("Try a broader search or
           * invite your first members to populate this directory.") guessed at
           * both at once and instructed the reader in either case.
           *
           * No CTA on any of them. §10 makes the empty-state action optional, and
           * the toolbar row above renders whether or not the list has rows, so
           * Invite is already on screen — a second copy of it inside the state
           * would be the same button twice, which reads worst here, where the
           * screen has nothing else on it. That is the reasoning the deleted
           * version carried, and it survives the flattening intact.
           */
          usingSearch ? (
            <NestedEmpty
              sole
              title={`No match for “${deferredQuery}”`}
              description={stateMicrocopy.members.noMatchDescription}
            />
          ) : narrowed ? (
            <NestedEmpty
              sole
              title={stateMicrocopy.members.filteredTitle}
              description={stateMicrocopy.members.filteredDescription}
            />
          ) : (
            <NestedEmpty
              sole
              title={stateMicrocopy.members.emptyTitle}
              description={stateMicrocopy.members.emptyDescription}
            />
          )
        ) : (
          <>
            {/*
            `role="list"` restored explicitly. `display:flex` on an `<li>` drops
            its `list-item` box, and WebKit stops exposing list semantics when
            it does — so without this a screen reader announces neither the list
            nor its item count. That matters more here than on a list that was
            always a list: this one replaces a `<table>`, which had strong
            semantics of its own, so silently landing on a bare group of buttons
            would be a real regression rather than a nit.
          */}
            <ul role="list" className={denseListClassName}>
              {pageMembers.map((member) => {
                const id = memberId(member);
                const name = displayNameOf(member);
                const roleName = primaryRoleName(member);
                const joined = formatJoined(member.created_at);
                const points = pointsOf(member);
                const status = presenceStatusOf(member);
                const selected = selectedMemberIds.includes(id);
                return (
                  <li
                    key={id}
                    className={cn(
                      "flex min-h-9 items-center gap-1 pointer-coarse:min-h-11",
                      // Fill means state, never striping. `accent-subtle-hover`
                      // is what the deleted `TableRow` painted for
                      // `data-state="selected"`, kept so selection still reads a
                      // step above the row hover below it.
                      selected && "bg-accent-subtle-hover text-accent-text",
                    )}
                  >
                    <label
                      className={`${dashboardCheckboxHitAreaClassName} shrink-0`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${name}`}
                        className={dashboardTableCheckboxClassName}
                        checked={selected}
                        onChange={(event) =>
                          toggleMember(id, event.target.checked)
                        }
                      />
                    </label>
                    {/*
                    The row is the control. `4a`'s note is "Click a row →
                    profile popover with Message", and the trailing "View
                    details" Secondary button this replaces was a 44px control
                    inside a row the lane pulled down to 36, so it would have
                    set the row's height on its own.

                    `aria-label` rather than the assembled subtree: the presence
                    dot is an `img`-role descendant, so without one the button
                    would be named "Online Jane Doe …" and would silently rename
                    itself whenever presence changed. Overriding the subtree
                    means restating everything the row shows, including the meta
                    line that `sm:` hides on a phone — so a screen-reader user
                    keeps the role, join date and email the layout drops.

                    `FOCUS_RING_OFFSET`, not `FOCUS_RING`: the row carries no
                    border, and `FOCUS_RING`'s indicator is the border swap.
                  */}
                    <button
                      type="button"
                      onClick={() => openMember(id)}
                      aria-label={[
                        name,
                        roleName,
                        `${points} points`,
                        joined ? `joined ${joined}` : null,
                        member.email || null,
                        status ? presenceLabel(status) : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      className={cn(
                        "flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors",
                        "pointer-coarse:min-h-11",
                        "hover:bg-accent-subtle hover:text-foreground",
                        FOCUS_RING_OFFSET,
                      )}
                    >
                      <div className="relative shrink-0">
                        <Avatar className="h-6 w-6">
                          {member.avatar_url ? (
                            <AvatarImage src={member.avatar_url} alt="" />
                          ) : null}
                          <AvatarFallback className="text-[9px]">
                            {initials(name)}
                          </AvatarFallback>
                        </Avatar>
                        <AvatarPresenceDot status={status} decorative />
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {name}
                      </span>
                      {/*
                      One meta line, `·`-joined, bounded fields first and the
                      free-text one last — lane 4's ordering rule, for the same
                      reason: this line truncates, so whatever leads it is what
                      survives a narrow row, and an email is the field that can
                      run long.
                    */}
                      <span className="hidden min-w-0 flex-1 truncate text-[12.5px] text-muted sm:block">
                        {[roleName, joined, member.email]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="shrink-0 text-[12.5px] tabular-nums text-muted">
                        {points} pts
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {pageCount > 1 ? (
              <div className="flex items-center justify-between gap-2 text-[12.5px]">
                <p className="text-muted">
                  Page {currentPage} of {pageCount}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={currentPage >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
    );
  }

  return (
    <>
      {renderBody()}
      {/*
        Outside `renderBody`, and rendered unconditionally, for the reason its
        docstring gives: an offline or error branch that replaced this would
        unmount a pending confirmation without settling its promise.
      */}
      <MemberDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        member={activeMember}
        points={activeMember ? pointsOf(activeMember) : null}
        usingPreviewData={false}
      />
    </>
  );
}
