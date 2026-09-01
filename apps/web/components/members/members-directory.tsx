"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, LayoutGrid, List } from "lucide-react";
import { InviteGlyph, SearchGlyph } from "@/components/members/directory-glyphs";
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
import { FOCUS_RING, FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState, OfflineState } from "@/components/shared/async-states";
import {
  dashboardCheckboxCellClassName,
  dashboardCheckboxHitAreaClassName,
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { useToast } from "@/hooks/use-toast";
import { InviteMemberDialog } from "@/components/members/invite-member-dialog";
import { MemberDetailSheet } from "@/components/members/member-detail-sheet";
import { useNetwork } from "@/lib/providers/network-provider";
import { vocab } from "@/lib/vocabulary";
import { asArray, initials } from "@/lib/utils";
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

function memberId(member: MemberRow): string {
  return String(member.id ?? member.user_id ?? "");
}

function displayNameOf(member: MemberRow): string {
  return typeof member.display_name === "string" && member.display_name.length > 0
    ? member.display_name
    : `Member ${String(member.user_id ?? "").slice(0, 8)}`;
}

function formatJoined(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/**
 * The actives half of the Directory.
 *
 * Extracted verbatim from the former `/members` page so `/members` can host
 * both halves behind a tab row (`app/(dashboard)/members/page.tsx`). The
 * alumni half is `AlumniDirectory`, which already had this shape.
 */
export function MembersDirectory() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [cohortFilter, setCohortFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "pending">("all");
  const [view, setView] = useState<"table" | "card">("table");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [bulkRoleId, setBulkRoleId] = useState<string>("");
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

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
  const usingSearch = deferredQuery.length > 0;
  const activeQuery = usingSearch ? searchQuery : membersQuery;

  const members = useMemo(() => {
    const raw = activeQuery.data;
    return Array.isArray(raw) ? (raw as MemberRow[]) : [];
  }, [activeQuery.data]);

  const roleOptions = useMemo<RoleOption[]>(() => {
    return asArray<Record<string, unknown>>(rolesQuery.data).flatMap((role) => {
      if (!role || typeof role !== "object") return [];
      if (typeof role.id !== "string" || typeof role.name !== "string") return [];
      // The President role carries the wildcard (`*`) permission. `PATCH
      // /members/:id/roles` rejects president changes (they go through the
      // dedicated presidency-transfer flow), so flag it to keep it out of the
      // bulk-assign dropdown below.
      const permissions = Array.isArray(role.permissions) ? role.permissions : [];
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
    for (const entry of asArray<Record<string, unknown>>(leaderboardQuery.data)) {
      if (typeof entry.user_id === "string" && typeof entry.total === "number") {
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
      if (typeof member.graduation_year === "number") years.add(member.graduation_year);
    }
    return [...years].sort((a, b) => b - a);
  }, [membersQuery.data]);

  const pointsOf = (member: MemberRow) => pointsByUserId.get(member.user_id) ?? 0;
  const primaryRoleName = (member: MemberRow): string => {
    const firstId = Array.isArray(member.role_ids) ? member.role_ids[0] : undefined;
    if (!firstId) return "—";
    return roleNameById.get(firstId) ?? firstId;
  };

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      if (roleFilter !== "all" && !(member.role_ids ?? []).includes(roleFilter)) {
        return false;
      }
      if (cohortFilter !== "all" && String(member.graduation_year ?? "") !== cohortFilter) {
        return false;
      }
      if (statusFilter === "active" && !member.has_completed_onboarding) return false;
      if (statusFilter === "pending" && member.has_completed_onboarding) return false;
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
            (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * factor
          );
        case "role":
          return primaryRoleName(a).localeCompare(primaryRoleName(b)) * factor;
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
    () => sortedMembers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [sortedMembers, currentPage],
  );

  // Changing the filter set or search swaps the visible population, so reset to
  // the first page and drop any selection/bulk-role draft — otherwise the
  // bulk-action bar would keep counting members that are no longer shown.
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
  }, [sortKey, sortDir]);

  const pageMemberIds = pageMembers.map(memberId);
  const allPageSelected =
    pageMemberIds.length > 0 && pageMemberIds.every((id) => selectedMemberIds.includes(id));
  const selectedCount = selectedMemberIds.length;
  const activeMember = useMemo(
    () => sortedMembers.find((member) => memberId(member) === activeMemberId) ?? null,
    [activeMemberId, sortedMembers],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
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

  if (isOffline) {
    return (
      <OfflineState
        title="Members directory unavailable offline"
        description="Reconnect to load live membership records and role updates."
        onRetry={() => {
          void membersQuery.refetch();
          if (usingSearch) void searchQuery.refetch();
        }}
      />
    );
  }

  if (activeQuery.isLoading) {
    return <LoadingState message={stateMicrocopy.members.loading} />;
  }

  if (activeQuery.isError) {
    return (
      <ErrorState
        title="Unable to load live member records"
        description="The members workflow no longer falls back to preview data. Verify your chapter access and API health, then retry."
        onRetry={() => {
          void activeQuery.refetch();
        }}
      />
    );
  }

  // Roles and points underpin the role filter, bulk assignment, the role column
  // and points sorting. If either query fails silently the directory still looks
  // healthy while those features are quietly broken, so surface their load state.
  if (rolesQuery.isLoading || leaderboardQuery.isLoading) {
    return <LoadingState message={stateMicrocopy.members.loading} />;
  }

  if (rolesQuery.isError || leaderboardQuery.isError) {
    return (
      <ErrorState
        title="Unable to load member directory data"
        description="Role metadata and points power filtering, assignment and sorting. Verify your chapter access and API health, then retry."
        onRetry={() => {
          void activeQuery.refetch();
          void rolesQuery.refetch();
          void leaderboardQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Members Directory</CardTitle>
            <CardDescription>Search and review chapter membership records.</CardDescription>
          </div>
          <InviteMemberDialog
            trigger={
              <Button className="gap-2">
                <InviteGlyph className="h-4 w-4" />
                Invite Member
              </Button>
            }
          />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md flex-1">
              <SearchGlyph className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Search members by name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by member name"
                className="h-11 pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
                  setStatusFilter(event.target.value as "all" | "active" | "pending")
                }
                className={dashboardFilterSelectClassName}
              >
                <option value="all">Status: All</option>
                <option value="active">Status: Active</option>
                <option value="pending">Status: Pending</option>
              </select>
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant={view === "table" ? "default" : "secondary"}
                  aria-label="Table view"
                  aria-pressed={view === "table"}
                  onClick={() => setView("table")}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant={view === "card" ? "default" : "secondary"}
                  aria-label="Card view"
                  aria-pressed={view === "card"}
                  onClick={() => setView("card")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedCount > 0 ? (
        <Card className="border-accent-border bg-accent-subtle">
          <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold">
              {selectedCount} member{selectedCount > 1 ? "s" : ""} selected
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Select role to assign"
                value={bulkRoleId}
                onChange={(event) => setBulkRoleId(event.target.value)}
                className={dashboardFilterSelectClassName}
              >
                <option value="">Assign role…</option>
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
          </CardContent>
        </Card>
      ) : null}

      {sortedMembers.length === 0 ? (
        /*
         * No CTA. §10 makes the empty-state action optional, and this one was a
         * control that did not do the thing it named: "Generate invite link"
         * raised a toast telling the reader to press the Invite Member button
         * instead — which is the dead end components.md §5 bans, and reads
         * worst here, where the screen has nothing else on it. That button is
         * genuinely on screen: the search-and-filter card above renders
         * whether or not the table has rows, so the empty state does not need
         * a second copy of it, and §7's description already points at it.
         */
        <EmptyState
          title={stateMicrocopy.members.emptyTitle}
          description={stateMicrocopy.members.emptyDescription}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Member Records</CardTitle>
            <CardDescription>
              {usingSearch
                ? `Search results for “${trimmedQuery}”`
                : `${sortedMembers.length} member${sortedMembers.length === 1 ? "" : "s"}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {view === "table" ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={dashboardCheckboxCellClassName}>
                      <label className={dashboardCheckboxHitAreaClassName}>
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
                      </label>
                    </TableHead>
                    <SortableHead label="Name" sortKey="name" active={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableHead label="Role" sortKey="role" active={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableHead label="Points" sortKey="points" active={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableHead label="Joined" sortKey="joined" active={sortKey} dir={sortDir} onSort={toggleSort} />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageMembers.map((member) => {
                    const id = memberId(member);
                    const name = displayNameOf(member);
                    return (
                      <TableRow
                        key={id}
                        data-state={
                          selectedMemberIds.includes(id) ? "selected" : undefined
                        }
                      >
                        <TableCell className={dashboardCheckboxCellClassName}>
                          <label className={dashboardCheckboxHitAreaClassName}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${name}`}
                              className={dashboardTableCheckboxClassName}
                              checked={selectedMemberIds.includes(id)}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  setSelectedMemberIds((prev) => [
                                    ...new Set([...prev, id]),
                                  ]);
                                  return;
                                }
                                setSelectedMemberIds((prev) =>
                                  prev.filter((c) => c !== id),
                                );
                              }}
                            />
                          </label>
                        </TableCell>
                        <TableCell className="font-semibold">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              {member.avatar_url ? (
                                <AvatarImage src={member.avatar_url} alt={name} />
                              ) : null}
                              <AvatarFallback>{initials(name)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <span>{name}</span>
                              {member.email ? (
                                <p className="text-[12.5px] text-muted-foreground">{member.email}</p>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{primaryRoleName(member)}</TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {pointsOf(member)}
                        </TableCell>
                        <TableCell>{formatJoined(member.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="secondary" onClick={() => openMember(id)}>
                            View details
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pageMembers.map((member) => {
                  const id = memberId(member);
                  const name = displayNameOf(member);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => openMember(id)}
                      className={`flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-center transition-colors hover:bg-accent-subtle ${FOCUS_RING}`}
                    >
                      <Avatar className="h-14 w-14">
                        {member.avatar_url ? (
                          <AvatarImage src={member.avatar_url} alt={name} />
                        ) : null}
                        <AvatarFallback>{initials(name)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold">{name}</p>
                        <p className="text-[12.5px] text-muted-foreground">{primaryRoleName(member)}</p>
                      </div>
                      <p className="text-[12.5px] text-muted-foreground">
                        {pointsOf(member)} pts · {formatJoined(member.created_at)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            {pageCount > 1 ? (
              <div className="flex items-center justify-between border-t border-border pt-4 text-sm">
                <p className="text-muted-foreground">
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
          </CardContent>
        </Card>
      )}

      <MemberDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        member={activeMember}
        points={activeMember ? pointsOf(activeMember) : null}
        usingPreviewData={false}
      />
    </div>
  );
}

function SortableHead({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  const direction = dir === "asc" ? "ascending" : "descending";
  return (
    <TableHead aria-sort={isActive ? direction : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        /*
         * `FOCUS_RING_OFFSET`, not `FOCUS_RING`. The standard recipe swaps the
         * border to accent and treats the ring as a halo — `focus.ts` is
         * explicit that the border swap is the half that carries it, since the
         * ring composites to ~1.3:1. This button has no border *width*
         * (Preflight zeroes it), so `border-primary` would recolour nothing
         * while `outline-none` removed the browser's own outline: a control
         * with no focus indicator at all, which is a README §6 release-gate
         * failure. The offset ring is solid accent and needs no border.
         */
        className={`-mx-1 flex items-center gap-1 rounded-xs px-1 font-semibold transition-colors hover:text-foreground ${FOCUS_RING_OFFSET}`}
        aria-label={
          isActive
            ? `Sort by ${label}, currently ${direction}`
            : `Sort by ${label}`
        }
      >
        {label}
        {isActive ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : null}
      </button>
    </TableHead>
  );
}
