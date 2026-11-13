"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  InviteGlyph,
  SearchGlyph,
} from "@/components/members/directory-glyphs";
import {
  useLeaderboard,
  useMemberDisplayNames,
  useMemberSearch,
  useMembers,
  usePledgeClasses,
  fraternalOrderComparator,
  usesFraternalOrder,
  useRoles,
  useUpdateMemberRoles,
} from "@repo/hooks";
import type { MemberProfile } from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { parseInstant } from "@repo/formatting";
import { vocab } from "@repo/org-archetypes";
import { useChapterVocabulary } from "@/lib/hooks/use-chapter-vocabulary";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterChip, SortChip } from "@/components/shared/filter-chip";
import { SectionLabel } from "@/components/shared/section-label";
import { anyReadUncached } from "@/components/shared/async-states";
/*
  The **nested** state family, not the whole-screen one, and on a page with no
  cards left that is the point rather than a technicality. `ErrorState` and its
  siblings paint `--card`; this lane just deleted the three `<Card>`s on this
  route, so rendering one would put the card back through the door the lane
  closed. `elevation-contrast.spec.ts` argues the same side from the other end —
  a hairline over an unfilled surface separates better than a `--card` panel's
  does, and its docblock names that assertion as "the one that should fail if
  someone restores the Card for consistency". Lane 4 moved `/documents` and
  `/backwork` across for this reason; this is the same move on the same grounds.

  `sole` on every one of them: each is the whole screen's only async state, so
  the titles need to be headings rather than paragraphs. Loading is not in
  this family any more; it is the roster's own skeleton
  (`directory-skeleton.tsx`).
*/
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
  dashboardToolbarSearchClassName,
  dashboardToolbarSearchGlyphClassName,
  denseListClassName,
} from "@/components/shared/table-controls";
import { useToast } from "@/lib/hooks/use-toast";
import { InviteMemberDialog } from "@/components/members/invite-member-dialog";
import { MemberDetailSheet } from "@/components/members/member-detail-sheet";
import { MemberGrid } from "@/components/members/member-grid";
import { useListLayout } from "@/lib/list-layout";
import { useNetwork } from "@/lib/providers/network-provider";
import {
  AvatarPresenceDot,
  CustomStatusLine,
} from "@/components/members/presence-dot";
import { useChapterPresenceContext } from "@/lib/providers/chapter-presence-provider";
import {
  presenceLabel,
  type PresenceStatus,
} from "@repo/hooks/presence-status";
import { directoryNoSearchMatches, isEveryoneRole } from "@repo/validation";
import { asArray, cn, initials } from "@/lib/utils";
import { stateMicrocopy } from "@/lib/state-microcopy";
import {
  MemberRowsSkeleton,
  MembersRosterSkeleton,
} from "@/components/members/directory-skeleton";

const PAGE_SIZE = 25;

type RoleOption = {
  id: string;
  name: string;
  isPresident: boolean;
  isAlumni: boolean;
};

type SortKey = "name" | "role" | "points" | "order";
type SortDir = "asc" | "desc";

/**
 * Sorting, as one control rather than four sortable column headers.
 *
 * The table this list replaces carried a `SortableHead` button in each of four
 * `<th>`s, which is the densest place to put sorting *in a table* and has no
 * home at all in a flat list — the board's list rows (`4a`) have no header row
 * to hang one on, and `1f` pin 2 gives a route one toolbar row holding "filter
 * menu, view toggle, primary action". So every reachable (key, direction)
 * pair becomes an option on one sort chip that sits with the filters, and no
 * direction state has to be inferred from a second click on the same header.
 *
 * Each pair is listed rather than the keys plus a direction toggle: the
 * toggle would be one more control in the row, and "Role Z to A" is cheaper
 * to read than an arrow glyph whose meaning depends on which column is active.
 * The fraternal-order sort is the exception, with one direction on purpose
 * (`ORDER_SORT`).
 *
 * "Newest first" and "Oldest first" are gone (#3939). They sorted on when a
 * membership row was created, which is when someone joined the chapter in
 * Frapp and not when they joined the chapter. The fraternal-order sort takes
 * their place for a chapter that keeps pledge classes or order numbers; it is
 * added in the component, because its label is the chapter's own word.
 */
const SORT_OPTIONS = [
  { value: "name:asc", label: "Name A to Z" },
  { value: "name:desc", label: "Name Z to A" },
  { value: "role:asc", label: "Role A to Z" },
  { value: "role:desc", label: "Role Z to A" },
  { value: "points:desc", label: "Most points" },
  { value: "points:asc", label: "Fewest points" },
] as const;

/**
 * The fraternal-order sort: oldest class first, then order number, then name
 * (`spec/behavior/members.md` § Pledge class and order number). One direction
 * only, because the order is a ranking the chapter keeps, not a column.
 */
const ORDER_SORT = "order:asc";

type SortValue = (typeof SORT_OPTIONS)[number]["value"] | typeof ORDER_SORT;

const DEFAULT_SORT: SortValue = "name:asc";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
] as const;

function parseSort(value: SortValue): { key: SortKey; dir: SortDir } {
  const [key, dir] = value.split(":");
  return { key: key as SortKey, dir: dir as SortDir };
}

function memberId(member: MemberProfile): string {
  return String(member.id ?? member.user_id ?? "");
}

function displayNameOf(member: MemberProfile): string {
  return memberLabel(member.display_name, member.user_id);
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
  const parsed = parseInstant(value);
  return parsed
    ? parsed.toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : null;
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
 * the same carve-out `compactControlClassName` and lane 4's folder rail take,
 * and the reading §2 spells out ("compact 34px controls are web/pointer-only").
 * It is deliberately *not* lane 4's flat `min-h-11` document row: that row is
 * not itself a control, where this one is the member's whole hit target, and
 * the lane's own density target is 32–36 on a pointer.
 */
export function MembersDirectory() {
  const { isOffline } = useNetwork();
  // The roster's role-color resolution, so a row's initials match the color
  // that member's name takes in chat (#3860).
  const { avatarTintFor } = useMemberDisplayNames();
  const { toast } = useToast();
  // List or Grid (#4175), picked in the Directory's tab row.
  const [layout] = useListLayout("directory");
  const [query, setQuery] = useState("");
  // `null` is "any", the shape `FilterChip` speaks.
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [cohortFilter, setCohortFilter] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"active" | "pending" | null>(
    null,
  );
  const [sort, setSort] = useState<SortValue>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [bulkRoleId, setBulkRoleId] = useState<string | null>(null);
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  // The sheet reads the profile by `users.id` itself (#3726), so it keeps its
  // member even once a role save moves them off this tab's list.
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  const chapterWords = useChapterVocabulary();
  const trimmedQuery = query.trim();
  // Keeps typing responsive without a debounce timer of our own: the query only
  // re-runs once React has caught up with the keystrokes. Matches the mobile
  // directory screen's guard against firing a request per keystroke.
  const deferredQuery = useDeferredValue(trimmedQuery);
  const membersQuery = useMembers();
  const classesQuery = usePledgeClasses();
  const searchQuery = useMemberSearch(deferredQuery);
  const rolesQuery = useRoles();
  const leaderboardQuery = useLeaderboard();
  const updateRolesMutation = useUpdateMemberRoles();
  // Presence is chapter-wide and ephemeral (ADR-02) — it rides the Realtime
  // socket and touches no table, so this adds no query and no write. The
  // subscription is owned by the dashboard shell, not by this screen: a member
  // is present because the app is open, not because they are on this page.
  const presence = useChapterPresenceContext();
  const usingSearch = deferredQuery.length > 0;
  const activeQuery = usingSearch ? searchQuery : membersQuery;

  // The Actives tab is the chapter minus its alumni (#2484), who are listed on
  // the Alumni tab beside it. `GET /v1/members` returns the whole chapter, so
  // the split is made here on the server's `is_alumni`, which it resolves
  // exactly as it builds `GET /v1/alumni`: the two tabs never both list one
  // member. `!== true` so a row from an API older than the flag reads as
  // active, the unsplit list this was before.
  //
  // A search is not split. It is the only name, email and custom-field search
  // the web directory has (the Alumni tab filters by class year, city and
  // company), and the directory is one surface precisely so nobody has to know
  // which list a person is on before looking them up. Mobile's s13 search
  // spans both lists for the same reason.
  const members = useMemo(() => {
    const rows = activeQuery.data ?? [];
    return usingSearch
      ? rows
      : rows.filter((member) => member.is_alumni !== true);
  }, [activeQuery.data, usingSearch]);

  const roleOptions = useMemo<RoleOption[]>(() => {
    return asArray<Record<string, unknown>>(rolesQuery.data).flatMap((role) => {
      if (!role || typeof role !== "object") return [];
      if (typeof role.id !== "string" || typeof role.name !== "string")
        return [];
      // The Everyone role (#4191) is no filter, column or assignment.
      if (isEveryoneRole(role)) return [];
      // The President role carries the wildcard (`*`) permission. `PATCH
      // /members/:id/roles` rejects president changes (they go through the
      // dedicated presidency-transfer flow), so flag it to keep it out of the
      // bulk-assign dropdown below.
      const permissions = Array.isArray(role.permissions)
        ? role.permissions
        : [];
      const isPresident = role.is_system === true && permissions.includes("*");
      // Read defensively, as the Discord import wizard reads it: `GET
      // /v1/roles` returns the whole row, `system_key` included, but declares
      // no response schema (#1049), so the SDK doesn't type it.
      const isAlumni = role.system_key === "ALUMNI";
      return [{ id: role.id, name: role.name, isPresident, isAlumni }];
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
  // The filters offer what the list on screen can hold (#2484). Outside a
  // search that is actives only, so the Alumni role is left out of the role
  // filter, where it could only match nothing; a search spans both tabs, so it
  // is offered then. It stays assignable either way, since bulk-assigning it
  // is how a graduating class moves.
  const filterRoleOptions = useMemo(
    () =>
      usingSearch ? roleOptions : roleOptions.filter((role) => !role.isAlumni),
    [roleOptions, usingSearch],
  );
  // A choice whose option has gone (Alumni picked during a search that has
  // since been cleared) reads as "any" rather than filtering on something the
  // chip no longer lists.
  const filterRoleChipOptions = useMemo(
    () =>
      filterRoleOptions.map((role) => ({ value: role.id, label: role.name })),
    [filterRoleOptions],
  );
  const assignableRoleChipOptions = useMemo(
    () =>
      assignableRoleOptions.map((role) => ({
        value: role.id,
        label: role.name,
      })),
    [assignableRoleOptions],
  );
  // A picked role that has since been deleted reads as unpicked, so the chip
  // never names an id and Apply never sends one.
  const effectiveBulkRoleId =
    bulkRoleId !== null &&
    assignableRoleOptions.some((role) => role.id === bulkRoleId)
      ? bulkRoleId
      : null;
  const effectiveRoleFilter =
    roleFilter !== null &&
    filterRoleOptions.some((role) => role.id === roleFilter)
      ? roleFilter
      : null;

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

  // Labelled "Graduation year", not the chapter's `class` word: the options are
  // each member's graduation year, and one pledge class can span several
  // graduation years (#3941). The `class` term is for real pledge classes.
  // Cohort options come from the full roster (not the search-narrowed list) so a
  // selected cohort never silently loses its option mid-search. Alumni class
  // years join them only while a search spans both tabs, as the role filter's
  // Alumni option does.
  const cohortOptions = useMemo(() => {
    const years = new Set<number>();
    for (const member of membersQuery.data ?? []) {
      if (!usingSearch && member.is_alumni === true) continue;
      if (typeof member.graduation_year === "number")
        years.add(member.graduation_year);
    }
    return [...years].sort((a, b) => b - a);
  }, [membersQuery.data, usingSearch]);
  const cohortChipOptions = useMemo(
    () =>
      cohortOptions.map((year) => ({
        value: String(year),
        label: String(year),
      })),
    [cohortOptions],
  );
  const effectiveCohortFilter =
    cohortFilter !== null &&
    cohortOptions.some((y) => String(y) === cohortFilter)
      ? cohortFilter
      : null;

  // Pledge class and order number (#3939). A chapter with no classes and no
  // numbers gets neither the sort nor the filter nor a class on its rows, so
  // nothing here assumes how a chapter runs.
  const pledgeClasses = useMemo(
    () => classesQuery.data ?? [],
    [classesQuery.data],
  );
  const classNameById = useMemo(
    () => new Map(pledgeClasses.map((entry) => [entry.id, entry.name])),
    [pledgeClasses],
  );
  const classChipOptions = useMemo(
    () =>
      pledgeClasses.map((entry) => ({ value: entry.id, label: entry.name })),
    [pledgeClasses],
  );
  const effectiveClassFilter =
    classFilter !== null && classNameById.has(classFilter) ? classFilter : null;
  // Only once the class list has loaded. The sort ranks by the chapter's class
  // order, so without the list it would rank every member as having no class
  // and look right while being wrong. A failed or offline class read therefore
  // costs the sort, the filter and the class on rows, and nothing else.
  const offersOrderSort =
    classesQuery.data !== undefined &&
    usesFraternalOrder(pledgeClasses, membersQuery.data);
  const sortOptions = useMemo(
    () =>
      offersOrderSort
        ? [
            ...SORT_OPTIONS,
            // The chapter's own word, as typed: "Fraternal order", "Roll number".
            { value: ORDER_SORT, label: vocab("order", chapterWords) } as const,
          ]
        : SORT_OPTIONS,
    [offersOrderSort, chapterWords],
  );
  // A sort the chapter no longer offers (its last class was deleted while the
  // page was open) falls back to the default rather than ordering by nothing.
  const effectiveSort: SortValue =
    sort === ORDER_SORT && !offersOrderSort ? DEFAULT_SORT : sort;
  const { key: sortKey, dir: sortDir } = parseSort(effectiveSort);

  const pointsOf = (member: MemberProfile) =>
    pointsByUserId.get(member.user_id) ?? 0;
  // `null` until presence has resolved for this chapter — the dot renders
  // nothing rather than claiming Offline, which would be a statement about the
  // member sourced from our own unfinished join.
  const presenceStatusOf = (member: MemberProfile): PresenceStatus | null =>
    presence.isReady ? presence.statusOf(member.user_id) : null;
  // The custom status line (#3845) rides presence, so it is `null` while
  // presence is unresolved, and for anyone offline or invisible.
  const customLineOf = (member: MemberProfile): string | null =>
    presence.isReady ? presence.lineOf(member.user_id) : null;
  // `null`, not an em dash, for the same reason `formatJoined` returns one: an
  // absent role drops out of the `·`-joined meta line rather than rendering a
  // placeholder glyph.
  // The first role the list knows, so the Everyone role (#4191), which it
  // leaves out, is skipped rather than shown as a raw id. While the roles load
  // the first id stands in, as before.
  const primaryRoleName = (member: MemberProfile): string | null => {
    const known = member.role_ids.find((id) => roleNameById.has(id));
    if (known) return roleNameById.get(known) ?? null;
    if (roleOptions.length > 0) return null;
    return member.role_ids[0] ?? null;
  };

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      if (
        effectiveRoleFilter !== null &&
        !member.role_ids.includes(effectiveRoleFilter)
      ) {
        return false;
      }
      if (
        effectiveCohortFilter !== null &&
        String(member.graduation_year ?? "") !== effectiveCohortFilter
      ) {
        return false;
      }
      if (
        effectiveClassFilter !== null &&
        member.pledge_class_id !== effectiveClassFilter
      ) {
        return false;
      }
      if (statusFilter === "active" && !member.has_completed_onboarding)
        return false;
      if (statusFilter === "pending" && member.has_completed_onboarding)
        return false;
      return true;
    });
  }, [
    members,
    effectiveRoleFilter,
    effectiveCohortFilter,
    effectiveClassFilter,
    statusFilter,
  ]);

  const sortedMembers = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    const byFraternalOrder = fraternalOrderComparator(pledgeClasses);
    return [...filteredMembers].sort((a, b) => {
      switch (sortKey) {
        case "points":
          return (pointsOf(a) - pointsOf(b)) * factor;
        case "order":
          return byFraternalOrder(a, b);
        case "role": {
          /*
            Members with no role sort last in BOTH directions, which takes a
            branch ahead of the `* factor` rather than a sentinel inside it.
            A sentinel is still compared and then flipped, so it only mirrors
            the empty string it replaces: "\uffff" lands roleless members last
            ascending and *first* descending, so "Role Z to A" would stack every
            member holding no office above every named one, on page 1 of a
            25-row pager. The direction toggle orders the named roles; a reader
            flipping it does not expect the roleless block to move at all.
          */
          const roleA = primaryRoleName(a);
          const roleB = primaryRoleName(b);
          if (!roleA && !roleB) return 0;
          if (!roleA) return 1;
          if (!roleB) return -1;
          return roleA.localeCompare(roleB) * factor;
        }
        case "name":
        default:
          return displayNameOf(a).localeCompare(displayNameOf(b)) * factor;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filteredMembers,
    sortKey,
    sortDir,
    pointsByUserId,
    roleNameById,
    pledgeClasses,
  ]);

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
    setBulkRoleId(null);
  }, [
    trimmedQuery,
    effectiveRoleFilter,
    effectiveCohortFilter,
    effectiveClassFilter,
    statusFilter,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Re-sorting keeps the same population; just return to the first page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- return to page 1 when sort identity changes
    setPage(1);
  }, [effectiveSort]);

  const pageMemberIds = pageMembers.map(memberId);
  const allPageSelected =
    pageMemberIds.length > 0 &&
    pageMemberIds.every((id) => selectedMemberIds.includes(id));
  // The selection counted and acted on is the part of it that still has a row.
  // A refetch can move a selected member off this tab (given Alumni from their
  // sheet, or by another officer), and an id with no row can't be unticked, so
  // it must not keep inflating "n selected" or the Apply that follows it.
  const visibleSelectedIds = useMemo(() => {
    const shown = new Set(sortedMembers.map(memberId));
    return selectedMemberIds.filter((id) => shown.has(id));
  }, [selectedMemberIds, sortedMembers]);
  const selectedCount = visibleSelectedIds.length;
  // Looked up in the unfiltered response, not in `sortedMembers`. The sheet
  // stays open after a role save, and the save refetches the list, so a member
  // an officer has just given the Alumni role (or who no longer matches the
  // role filter) drops out of this tab while their sheet is still up. Found in
  // the filtered list, that sheet would lose its member mid-edit and render an
  // unknown one with its roles cleared.
  const activeMember = useMemo(
    () =>
      (activeQuery.data ?? []).find(
        (member) => memberId(member) === activeMemberId,
      ) ?? null,
    [activeMemberId, activeQuery.data],
  );
  // A filter or a search term is the difference between "this chapter has no
  // members" and "nothing matched what you asked for" — two different states on
  // the board (`3b`: "Empty = accent tile + tinted CTA. No results = neutral
  // tile, names the query"), which this surface used to answer with one string
  // that guessed at both.
  const narrowed =
    usingSearch ||
    effectiveRoleFilter !== null ||
    effectiveCohortFilter !== null ||
    effectiveClassFilter !== null ||
    statusFilter !== null;

  /**
   * What a member's row and tile both show, and the accessible name that
   * restates all of it in a fixed order with the status last. An
   * `aria-label` replaces the subtree's text as the name, so it must keep
   * every fact on screen.
   */
  function factsOf(member: MemberProfile) {
    const name = displayNameOf(member);
    const roleName = primaryRoleName(member);
    const joined = formatJoined(member.created_at);
    const className = member.pledge_class_id
      ? (classNameById.get(member.pledge_class_id) ?? null)
      : null;
    const points = pointsOf(member);
    const status = presenceStatusOf(member);
    const customLine = customLineOf(member);
    const label = [
      name,
      roleName,
      className,
      `${points} points`,
      joined ? `joined ${joined}` : null,
      member.email || null,
      customLine,
      status ? presenceLabel(status) : null,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      name,
      roleName,
      joined,
      className,
      points,
      status,
      customLine,
      label,
    };
  }

  function toggleMember(id: string, isSelected: boolean) {
    setSelectedMemberIds((prev) =>
      isSelected ? [...new Set([...prev, id])] : prev.filter((c) => c !== id),
    );
  }

  function openMember(member: MemberProfile) {
    setActiveMemberId(memberId(member));
    setActiveUserId(typeof member.user_id === "string" ? member.user_id : null);
    setDetailSheetOpen(true);
  }

  async function applyBulkRole() {
    if (!effectiveBulkRoleId || selectedCount === 0) return;
    const targets = sortedMembers.filter(
      (member) =>
        selectedMemberIds.includes(memberId(member)) &&
        !member.role_ids.includes(effectiveBulkRoleId),
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
          role_ids: [...new Set([...member.role_ids, effectiveBulkRoleId])],
        }),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    const succeeded = targets.length - failed;
    const roleName = roleNameById.get(effectiveBulkRoleId) ?? "role";

    if (failed === 0) {
      toast({
        title: "Role assigned",
        description: `Added ${roleName} to ${succeeded} member${succeeded === 1 ? "" : "s"}.`,
      });
      setSelectedMemberIds([]);
      setBulkRoleId(null);
    } else {
      toast({
        title: "Some assignments failed",
        description: `${roleName}: ${succeeded} updated, ${failed} failed. Retry the rest.`,
        variant: "destructive",
      });
      // Narrow the selection to exactly "the rest", which is what the toast
      // asks the officer to retry.
      setSelectedMemberIds(
        targets
          .filter((_, index) => results[index]?.status === "rejected")
          .map(memberId),
      );
    }
  }

  /*
   * Roles and points are in this gate, not just the member rows, because the
   * two guards below that would otherwise catch them are dead for a read that
   * paused offline: a paused query is neither `isLoading` nor `isError`
   * (offline it may fail instead — `anyReadUncached` has both). Without them the
   * directory renders every member at 0 points under a raw role UUID, with an
   * empty role filter and meaningless points sorting — which is exactly the
   * "looks healthy while quietly broken" state the comment on those guards
   * exists to prevent.
   */
  if (isOffline && anyReadUncached(activeQuery, rolesQuery, leaderboardQuery)) {
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
    return <MembersRosterSkeleton />;
  }

  if (activeQuery.isError) {
    return (
      <NestedError
        sole
        title={stateMicrocopy.members.errorTitle}
        description={describeLoadFailure(activeQuery.error)}
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
    return <MembersRosterSkeleton />;
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
        {/*
          The count is suppressed while a search is in flight rather than
          rendering "0 members matching …", which is a claim about the roster
          made before the answer is back.
        */}
        <SectionLabel
          id="members-list-label"
          count={
            activeQuery.isLoading
              ? null
              : `${sortedMembers.length} member${sortedMembers.length === 1 ? "" : "s"}${usingSearch ? ` matching “${deferredQuery}”` : ""}`
          }
        >
          {/* A search spans both tabs (see `members` above), so say so. */}
          {usingSearch ? "Actives and alumni" : "Actives"}
        </SectionLabel>
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
          <div className="relative w-full @md:w-56">
            {/*
            "Search members", not "Search by member name": `GET
            /v1/members/search` matches name, email and custom-field values
            (`spec/behavior/members.md`), so naming only the name narrowed the
            control in its own label.
          */}
            <Label htmlFor="member-search" className="sr-only">
              Search members
            </Label>
            <SearchGlyph className={dashboardToolbarSearchGlyphClassName} />
            <Input
              id="member-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members"
              className={dashboardToolbarSearchClassName}
            />
          </div>
          {/*
          The shared filter chips, as `/backwork` and `/documents` use them
          (#3970; native selects until then). Role is the long one: past
          `FILTER_SEARCH_THRESHOLD` options its list opens with a
          type-to-filter field, so a chapter with 100+ imported roles can
          type for one instead of scrolling.
        */}
          <FilterChip
            label="Role"
            anyLabel="Any role"
            options={filterRoleChipOptions}
            value={effectiveRoleFilter}
            onChange={setRoleFilter}
          />
          <FilterChip
            label="Graduation year"
            anyLabel="Any year"
            options={cohortChipOptions}
            value={effectiveCohortFilter}
            onChange={setCohortFilter}
          />
          {/*
            Beside graduation year, and separate from it: one pledge class can
            span several graduation years (#3939, #3941). Labelled with the
            chapter's own word, in the chapter's own order, and absent for a
            chapter that keeps no classes.
          */}
          {classChipOptions.length > 0 ? (
            <FilterChip
              label={vocab("class", chapterWords)}
              anyLabel="Any"
              options={classChipOptions}
              value={effectiveClassFilter}
              onChange={setClassFilter}
            />
          ) : null}
          <FilterChip
            label="Status"
            anyLabel="Any status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(value) =>
              setStatusFilter(value as "active" | "pending" | null)
            }
          />
          <SortChip
            options={sortOptions}
            value={effectiveSort}
            onChange={setSort}
          />
          {/*
          The route's primary action, at the trailing edge of the one toolbar
          row `1f` pin 2 describes. It renders above the empty state as well
          as above a populated list, which is what lets the empty state carry
          no CTA of its own without leaving the member nothing to do.
        */}
          <InviteMemberDialog
            trigger={
              <Button size="toolbar" className="gap-2">
                <InviteGlyph className="h-4 w-4" />
                Invite member
              </Button>
            }
          />
        </div>
      </div>

      {/*
        The selection bar `1f` pin 4 names, in place of the accent-tinted
        `<Card>` that used to stack above the results card. It is a flush
        neutral strip (`--popover`, since 2026-11-05: a count is not an action,
        `foundations.md` §6) rather than a card because the page has no cards
        left for it to sit beside.

        **The select-all is NOT in here**, and an earlier draft of this lane put
        it here on the reasoning that the toolbar should not carry a permanently
        visible control for a bulk action most members cannot complete. That
        reasoning cost two things the deleted `<th>` checkbox had. It was
        unreachable from zero — you could not select a page without first
        ticking a row — and worse, it destroyed itself when used: unticking it
        drives the selection to zero, which unmounts the bar holding the
        checkbox that currently has focus, dropping a keyboard user to `<body>`
        to restart tabbing from the top. `Clear` and a successful `Apply` are
        the same shape. So the select-all lives in the always-rendered list
        header below, where it behaves like the header control it replaces, and
        only the *count* and the bulk action are conditional.
      */}
      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-popover px-2 py-1.5">
          <p className="text-caption font-semibold text-foreground">
            {selectedCount} selected
          </p>
          <div className="flex flex-wrap items-center gap-2 @md:ml-auto">
            <FilterChip
              label="Assign role"
              anyLabel="No role"
              options={assignableRoleChipOptions}
              value={effectiveBulkRoleId}
              onChange={setBulkRoleId}
            />
            <Button
              size="sm"
              onClick={() => void applyBulkRole()}
              disabled={!effectiveBulkRoleId || updateRolesMutation.isPending}
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSelectedMemberIds([]);
                setBulkRoleId(null);
              }}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {activeQuery.isLoading ? (
        <MemberRowsSkeleton />
      ) : sortedMembers.length === 0 ? (
        /*
         * One line where the rows go, not a card (empty-states plan rule 7,
         * `writing.md` §4): a search or a filter that matches nothing says so
         * and offers the way back, and the toolbar above stays put. A roster
         * with nobody on it has no way back to offer; Invite is already in
         * the toolbar.
         */
        usingSearch ? (
          <InlineNote>
            {directoryNoSearchMatches(deferredQuery)}{" "}
            <InlineNoteAction onClick={() => setQuery("")}>
              Clear search
            </InlineNoteAction>
          </InlineNote>
        ) : narrowed ? (
          <InlineNote>
            {stateMicrocopy.members.noFilterMatches}{" "}
            <InlineNoteAction
              onClick={() => {
                setRoleFilter(null);
                setCohortFilter(null);
                setClassFilter(null);
                setStatusFilter(null);
              }}
            >
              Clear filters
            </InlineNoteAction>
          </InlineNote>
        ) : (
          <InlineNote>{stateMicrocopy.members.empty}</InlineNote>
        )
      ) : (
        <>
          {/*
          On the `<ul>` below: `role="list"` restored explicitly. `display:flex` on an `<li>` drops
          its `list-item` box, and WebKit stops exposing list semantics when
          it does — so without this a screen reader announces neither the list
          nor its item count. That matters more here than on a list that was
          always a list: this one replaces a `<table>`, which had strong
          semantics of its own, so silently landing on a bare group of buttons
          would be a real regression rather than a nit.
        */}
          {/*
            The list header, which is all that survives of the deleted
            `<thead>`: no column labels (a flush list has no columns to label)
            and no sort buttons (one sort chip in the toolbar replaced four),
            but the select-all stays, permanently rendered.

            It is here rather than in the selection bar because a control must
            not be conditioned on its own output. Inside the bar it could not be
            reached until a row had been ticked individually, and unticking it
            emptied the selection, which unmounted the bar around the checkbox
            that had focus. Here it behaves exactly as the `<th>` checkbox did.
          */}
          <label className="flex w-fit min-h-9 cursor-pointer items-center gap-2 text-caption text-muted pointer-coarse:min-h-11">
            <span className={dashboardCheckboxHitAreaClassName}>
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
            </span>
            Select all on this page
          </label>
          {layout === "grid" ? (
            <MemberGrid
              members={pageMembers}
              idOf={memberId}
              factsOf={factsOf}
              selectedIds={selectedMemberIds}
              onToggle={toggleMember}
              onOpen={openMember}
              avatarTintFor={avatarTintFor}
            />
          ) : (
            <ul role="list" className={denseListClassName}>
              {pageMembers.map((member) => {
                const id = memberId(member);
                const {
                  name,
                  roleName,
                  joined,
                  className,
                  points,
                  status,
                  customLine,
                  label,
                } = factsOf(member);
                const selected = selectedMemberIds.includes(id);
                return (
                  <li
                    key={id}
                    className={cn(
                      "flex min-h-9 items-center gap-1 pointer-coarse:min-h-11",
                      // Fill means state, never striping. `--popover` is what
                      // `TableRow` paints for `data-state="selected"`: neutral
                      // since 2026-11-05 (`foundations.md` §6), a step under the
                      // `--card-hover` hover so a control inside the row still
                      // lifts, with the checked box and the "N selected" bar
                      // carrying the selection.
                      selected && "bg-popover",
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

                  `aria-label` rather than the assembled subtree, and the reason
                  is **ordering**, not the presence dot: the dot is `aria-hidden`
                  now that `AvatarPresenceDot` has no labelled variant, so it
                  contributes nothing to this button's name. An assembled name
                  would read the row's own visual order and change shape with the
                  layout, where the label states the same facts in a fixed order
                  with the status last, and adds the status the dot conveys only
                  in colour. It must keep restating every fact the row shows: an
                  `aria-label` overrides the whole subtree, so anything left out
                  of it is dropped from the accessible name even though it is on
                  screen.

                  `FOCUS_RING_OFFSET`, not `FOCUS_RING`: the row carries no
                  border, and `FOCUS_RING`'s indicator is the border swap.
                */}
                    <button
                      type="button"
                      onClick={() => openMember(member)}
                      aria-label={label}
                      className={cn(
                        "flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors",
                        "pointer-coarse:min-h-11",
                        /*
                        Hover only while NOT selected. The selected fill lives
                        on the `<li>` and this button is `flex-1`, so a hover
                        here would paint across everything right of the
                        checkbox and the selected row would stop reading as
                        one row.
                      */
                        !selected &&
                          "hover:bg-card-hover hover:text-foreground",
                        FOCUS_RING_OFFSET,
                      )}
                    >
                      <div className="relative shrink-0">
                        <Avatar className="h-6 w-6">
                          {member.avatar_url ? (
                            <AvatarImage src={member.avatar_url} alt="" />
                          ) : null}
                          <AvatarFallback
                            className="text-[9px]"
                            tint={
                              typeof member.user_id === "string"
                                ? avatarTintFor(member.user_id)
                                : null
                            }
                          >
                            {initials(name)}
                          </AvatarFallback>
                        </Avatar>
                        <AvatarPresenceDot status={status} />
                      </div>
                      {/*
                      Name over meta below the page's `@xl` (576px), side by side above it — the
                      stacking shape lane 4's document row uses. An earlier
                      draft hid the meta line outright on a phone (`hidden
                      sm:block`), which puts the role, join date and email in no
                      form at all at the 375px floor this repo measures:
                      `display:none` takes them out of the accessibility tree
                      too, so the row's own `aria-label` was the only place they
                      survived.
                    */}
                      <span className="flex min-w-0 flex-1 flex-col @xl:flex-row @xl:items-center @xl:gap-3">
                        {/*
                        The custom status line (#3845) stacks under the name in
                        both layouts, one muted caption line that truncates.
                      */}
                        <span className="flex min-w-0 flex-col @xl:flex-1">
                          <span className="min-w-0 truncate text-sm font-semibold">
                            {name}
                          </span>
                          <CustomStatusLine line={customLine} />
                        </span>
                        {/*
                        One meta line, `·`-joined, bounded fields first and the
                        free-text one last — lane 4's ordering rule, for the
                        same reason: this line truncates, so whatever leads it
                        is what survives a narrow row, and an email is the field
                        that can run long.
                      */}
                        <span className="min-w-0 truncate text-caption text-muted @xl:flex-1">
                          {[roleName, className, joined, member.email]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-caption tabular-nums text-muted">
                        {points} pts
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {pageCount > 1 ? (
            <div className="flex items-center justify-between gap-2 text-caption">
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
      {/*
        Rendered inside the success branch, which is where every other screen
        using `useConfirmDialog` renders its dialog — and the early returns
        above are safe for it. `ConfirmDialogHost` carries
        `useEffect(() => () => onSettle(null))` precisely so a pending
        confirmation settles when the caller stops rendering it, and
        `confirm-dialog.spec.tsx`'s "resolves null when the caller stops
        rendering the dialog" pins that against this exact shape. An earlier
        draft of this lane hoisted the sheet out of the state branches to
        "fix" a hang that the primitive had already fixed — and paid for it,
        since a sheet that outlives its own query looks up `activeMember` in an
        empty `sortedMembers` and renders an unknown member with its roles
        cleared and a Save that silently no-ops.
      */}
      <MemberDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        userId={activeUserId}
        initialMember={activeMember}
        points={activeMember ? pointsOf(activeMember) : null}
        docked
        backLabel="Back to directory"
      />
    </section>
  );
}
