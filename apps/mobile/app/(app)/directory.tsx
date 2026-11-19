import { parseChapterRoles } from "@repo/hooks/chapter-roles";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
  useAlumni,
  useMemberDisplayNames,
  useMemberPhoneReach,
  useMemberSearch,
  useMembers,
  usePermissionList,
  usePledgeClasses,
  useRoles,
  usesFraternalOrder,
  type MemberAvatarTint,
} from "@repo/hooks";
import { useRouter } from "expo-router";
import {
  can,
  DIRECTORY_COPY,
  directoryNoSearchMatches,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { MemberAvatar } from "@/components/member-avatar";
import { AvatarWithPresence } from "@/components/avatar-with-presence";
import { presenceLabel } from "@repo/hooks/presence-status";
import {
  NO_PRESENCE,
  usePresenceOf,
  type MemberPresence,
} from "@/lib/presence/presence-store";
import {
  ErrorState,
  NoChapterState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import {
  BACK_TO_YOU,
  PinnedBackRow,
  pinnedBackClearance,
} from "@/components/back-row";
import { Chip, FilterChips, SearchField } from "@/components/filter-chips";
import {
  CREATE_BUTTON_SIZE,
  FloatingCreateButton,
} from "@/components/floating-create-button";
import { gutterBleed, usePressFeedback } from "@/components/list-section";
import { InlineNote } from "@/components/inline-note";
import { screenTitleStyle } from "@/components/screen-shell";
import {
  ThemedRefreshControl,
  useRefetchAll,
} from "@/components/pull-to-refresh";
import { ActivesFilterSheet } from "@/components/directory/actives-filter-sheet";
import {
  phoneReachCountLineFor,
  phoneReachStaleNote,
  phoneReachStateLabel,
  type PhoneReach,
} from "@repo/validation";
import { PickRolesSheet } from "@/components/roles/pick-roles-sheet";
import { usePickableRoles } from "@repo/hooks";
import {
  countActivesFilters,
  effectiveActivesFilter,
  filterActives,
  graduationYearOptions,
  NO_ACTIVES_FILTER,
  activesFilterRoles,
  type ActivesFilter,
} from "@/lib/directory/actives-filter";
import {
  type DirectoryRow,
  selectActives,
  selectDirectoryRows,
} from "@/lib/more/directory";
import { records, str } from "@/lib/more/narrow";
import {
  classNamesById,
  usePledgeClassTerms,
} from "@/lib/directory/pledge-class";
import { FLOATING_TAB_BAR, useTabBarClearance } from "@/lib/floating-chrome";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { ScreenReady } from "@/lib/sentry/screen-ready";

/**
 * s13 — Directory (`canvas-screens.dc.html:451`).
 *
 * ## Not on `ScreenShell`
 *
 * The shell wraps its children in a `ScrollView`, and a chapter's alumni list
 * runs to hundreds of rows with no pagination on any of the three endpoints
 * this screen reads — so inside the shell every row would mount at once. This
 * is the same opt-out `chat-thread.tsx` and `chapter-picker.tsx` make
 * (`spec/ui/mobile/patterns.md`), with the title, chips and search field riding
 * in `ListHeaderComponent` so the chrome still matches.
 *
 * ## Rows push the member's profile
 *
 * A row pushes `/member` (`components/directory/member-profile-screen.tsx`),
 * as iOS Contacts and Slack's member directory push a person's page (#5568,
 * Paul 2026-11-19). It was a full-height bottom sheet until then.
 *
 * ## One layout, quiet chips (#5568)
 *
 * Rows only: the List | Grid round (#4175) came out with Paul's ban on view
 * switchers (`spec/ui/design-system/README.md` § 2, 2026-11-17). The chips
 * above the list draw their quiet selected state, so the colour on the
 * screen is the members' own (their faces and initials), not the filter.
 *
 * ## `useMembers()` here is not the over-fetch #986 objected to
 *
 * That objection was about resolving chat *display names* through the full
 * profile endpoint, which puts every member's email and bio on the device to
 * draw a name — `GET /v1/members/roster` exists for that. The directory is the
 * surface `/v1/members` was built for, and the roster projection carries no
 * graduation year or company, so it cannot draw the meta line at all.
 *
 * ## Invite, for whoever may
 *
 * A member who holds `members:invite` (by default the President alone) gets
 * the screen's floating + (`spec/ui/mobile/patterns.md` § Create actions),
 * "Invite members", which opens the Invite members screen with `‹ Directory`
 * under it. The roster is where Discord and web put Invite, so it is where a
 * President looks first (owner ask 2026-11-06). While the permission read
 * loads the button is absent, which fails closed.
 *
 * ## Pledge class and fraternal order (#3939)
 *
 * `spec/behavior/members.md` § Pledge class and order number. A member's class
 * leads their row's meta line, and the Actives tab's chip row ends with a
 * chip, "Sort:" and the chapter's word for a member's order number, that
 * lists the actives in fraternal order instead of by name. Canvas draws no
 * sort on this screen, so the chip is this file's addition: one toggle, on the
 * row that already carries the Alumni tab's Filters chip, because the list has
 * exactly two orders. As on web, all of it waits for the class list: a chapter
 * with no classes and no numbers sees none of it, and a class list that has
 * never answered drops the chip and the names rather than sort by a list it
 * doesn't have. The sort is the Actives tab's alone, by choice: the Alumni
 * tab's trailing chip is Filters, and web's Alumni tab has no sort either
 * (#4088). Alumni rows still name their class, since `GET /v1/alumni` returns
 * it. Read-only on the list; an officer holding `roles:manage` sets both from
 * the member profile a row opens (#3991), or on web.
 *
 * ## Actives filters (#3971)
 *
 * The Actives tab's chip row carries a Filters chip, before the sort, that
 * opens `ActivesFilterSheet`: Status, Graduation year, the chapter's pledge
 * class and Role, web's four Directory filters by web's rules
 * (`lib/directory/actives-filter.ts`). The Alumni tab keeps its own Filters
 * chip and fields, since `GET /v1/alumni` filters server-side by different
 * fields. Like the alumni filters, these stay set across a tab switch and
 * are left alone by a search, which looks across both lists.
 */
type Tab = "actives" | "alumni";

export default function DirectoryScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const tabBarClearance = useTabBarClearance();
  const chapterId = useActiveChapterId();
  const router = useRouter();
  // The roster's role-color resolution, so a row's initials match the color
  // that member's name takes in chat (#3860).
  const { avatarTintFor } = useMemberDisplayNames();
  const canInvite = can("members:invite", usePermissionList());
  const activesFilterSheetRef = useRef<BottomSheetModal>(null);
  const pickRolesSheetRef = useRef<BottomSheetModal>(null);
  const pickable = usePickableRoles();
  const [activesFilterPicks, setActivesFilterPicks] =
    useState<ActivesFilter>(NO_ACTIVES_FILTER);

  const [tab, setTab] = useState<Tab>("actives");
  const [query, setQuery] = useState("");
  // Keeps typing responsive without a debounce timer of our own: the query only
  // re-runs once React has caught up with the keystrokes.
  const deferredQuery = useDeferredValue(query.trim());

  // Self-reported alumni fields, mirroring the web alumni directory
  // (`apps/web/components/alumni/alumni-directory.tsx`) — same three filters,
  // same `useAlumni` params. Filters persist across a tab switch (the fields
  // are only shown on the Alumni tab, but staying applied means returning to
  // it doesn't silently drop what was typed). Held as one object, rather than
  // three parallel `useState`s, so `hasAlumniFilters`, the Filters chip's
  // count and the `useAlumni` call below all derive from the same value, by
  // the one rule in `countSetFilters`, instead of hand-written copies of "is
  // any filter set" drifting apart.
  const [alumniFilterInputs, setAlumniFilterInputs] = useState({
    gradYear: "",
    city: "",
    company: "",
  });
  const alumniFilters = useMemo(
    () => ({
      graduation_year: alumniFilterInputs.gradYear.trim() || undefined,
      city: alumniFilterInputs.city.trim() || undefined,
      company: alumniFilterInputs.company.trim() || undefined,
    }),
    [alumniFilterInputs],
  );
  const deferredAlumniFilters = useDeferredValue(alumniFilters);
  // The three fields sit behind a Filters chip rather than always stacking
  // under the tabs, where they pushed the alumni list down by three field
  // heights before a member had typed anything. The chip counts the fields
  // that are set, so a filter left on while the fields are folded away still
  // shows; the count reads the typed values, so it moves with the keystroke.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const alumniFilterCount = countSetFilters(alumniFilters);
  // The deferred value, as the query reads: this picks the empty state for
  // the list that query returns.
  const hasAlumniFilters = countSetFilters(deferredAlumniFilters) > 0;

  const membersQuery = useMembers();
  const classesQuery = usePledgeClasses();
  const { classTerm, orderTerm } = usePledgeClassTerms();
  const rolesQuery = useRoles();
  const filterRoles = useMemo(
    () => activesFilterRoles(parseChapterRoles(rolesQuery.data)),
    [rolesQuery.data],
  );
  // `null` until the list has answered once. The last list read is kept when
  // a refetch fails, as web keeps it (and as the members list beside it is
  // kept), so a weak signal doesn't strip the names and undo the sort.
  const pledgeClasses = classesQuery.data ?? null;
  const classNames = useMemo(
    () => classNamesById(pledgeClasses),
    [pledgeClasses],
  );
  const [sortByOrder, setSortByOrder] = useState(false);
  const alumniQuery = useAlumni(deferredAlumniFilters);
  const searchQuery = useMemberSearch(deferredQuery);

  const isSearching = deferredQuery.length > 0;
  const activeQuery = isSearching
    ? searchQuery
    : tab === "actives"
      ? membersQuery
      : alumniQuery;
  // Both lists, since the tab chips count each, and the search results
  // while there is a term (that query is off without one).
  const refresh = useRefetchAll([
    membersQuery,
    alumniQuery,
    searchQuery,
    classesQuery,
    rolesQuery,
  ]);

  // `GET /v1/members` is the whole chapter; the Actives tab is the part of it
  // that isn't on the Alumni tab (#2484). Search stays directory-wide: it hides
  // the chips and looks across both lists.
  const actives = useMemo(
    () => selectActives(membersQuery.data),
    [membersQuery.data],
  );
  const yearOptions = useMemo(() => graduationYearOptions(actives), [actives]);
  // Whether Frapp's notifications reach each member's phone (web's "Phone
  // app" chip). The server sends the whole chapter's only to officers who
  // can invite members or manage roles, and the filter is offered only then.
  const { reach: phoneReach } = useMemberPhoneReach();
  const showsPhoneReach = phoneReach?.scope === "chapter";
  // A pick that no longer exists reads as unpicked (see `effectiveActivesFilter`).
  const activesFilter = useMemo(
    () =>
      effectiveActivesFilter(activesFilterPicks, {
        roleIds: new Set(filterRoles.map((role) => role.id)),
        years: yearOptions,
        classIds: new Set(classNames.keys()),
        phoneReach: showsPhoneReach,
      }),
    [activesFilterPicks, filterRoles, yearOptions, classNames, showsPhoneReach],
  );
  const activesFilterCount = countActivesFilters(activesFilter);
  const filteredActives = useMemo(
    () => filterActives(actives, activesFilter, phoneReach?.byUserId),
    [actives, activesFilter, phoneReach],
  );
  // The member's reach on their row, only while the Phone app filter is set
  // on the Actives tab, so the everyday list stays as it was.
  const rowReach = (userId: string): PhoneReach | undefined =>
    !isSearching && tab === "actives" && activesFilter.phoneReach !== null
      ? phoneReach?.byUserId.get(userId)
      : undefined;
  const phoneReachLine =
    !isSearching &&
    tab === "actives" &&
    activesFilter.phoneReach !== null &&
    phoneReach
      ? phoneReachCountLineFor(
          actives.map((row) =>
            typeof row.user_id === "string" ? row.user_id : null,
          ),
          phoneReach.byUserId,
        )
      : null;
  const listData =
    !isSearching && tab === "actives" ? filteredActives : activeQuery.data;
  // Asked of the actives, the list the chip sorts: a chapter whose only
  // numbered members are alumni would otherwise get a chip that does nothing.
  const orderOffered =
    pledgeClasses !== null && usesFraternalOrder(pledgeClasses, actives);

  // The Actives list alone: search looks across both lists, and the
  // Alumni tab has no sort (see the header).
  const inFraternalOrder =
    sortByOrder && orderOffered && !isSearching && tab === "actives";
  const rows = useMemo(
    () =>
      selectDirectoryRows(listData, {
        classNames,
        fraternalOrder:
          inFraternalOrder && pledgeClasses ? pledgeClasses : undefined,
      }),
    [listData, classNames, inFraternalOrder, pledgeClasses],
  );
  // Counted, not selected: `selectDirectoryRows` maps and sorts, and sorting to
  // read a `.length` would run a full `localeCompare` sort over both lists on
  // every keystroke. `null` until the query succeeds, so a populated tab never
  // advertises "· 0" while it loads.
  const activesCount = useMemo(
    () => (membersQuery.isSuccess ? countMembers(actives) : null),
    [membersQuery.isSuccess, actives],
  );
  // `null` (no count shown, per the comment above) while filters are active:
  // the chip's job is reporting the chapter's total alumni, and once a filter
  // narrows `alumniQuery` that total isn't what it's counting any more — a
  // stale filtered number would misread as the real total once the officer
  // switches back to the Actives tab without clearing it.
  const alumniCount = useMemo(
    () =>
      alumniQuery.isSuccess && !hasAlumniFilters
        ? countMembers(alumniQuery.data)
        : null,
    [alumniQuery.isSuccess, alumniQuery.data, hasAlumniFilters],
  );

  const header = (
    <View style={[styles.header, { paddingTop: pinnedBackClearance(tokens) }]}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.title}>
          Directory
        </Text>
        <View style={styles.titleActions}>
          {/* Add roles (#4958): placement provisional, pending Paul. */}
          {pickable.roles.length > 0 ? (
            <Chip
              accessibilityRole="button"
              accessibilityState={{}}
              accessibilityHint="Pick the Non-chapter business roles you want, like intramurals."
              label="Add roles"
              on={false}
              quiet
              onPress={() => pickRolesSheetRef.current?.present()}
            />
          ) : null}
        </View>
      </View>

      <SearchField
        value={query}
        onChangeText={setQuery}
        // "Search members", web's word: `GET /v1/members/search` matches
        // more than the name, so "by name" undersold it (#4137).
        placeholder="Search members"
        accessibilityLabel="Search the directory"
        searchGlyph
      />

      {isSearching ? null : (
        <FilterChips
          accessibilityLabel="Actives or alumni"
          scroll
          quiet
          selected={tab}
          onSelect={(value) => setTab((value as Tab) ?? "actives")}
          chips={[
            { value: "actives", label: "Actives", count: activesCount },
            { value: "alumni", label: "Alumni", count: alumniCount },
          ]}
          trailing={
            tab === "alumni" ? (
              <Chip
                accessibilityRole="button"
                accessibilityState={{ expanded: filtersOpen }}
                accessibilityLabel={
                  alumniFilterCount > 0
                    ? `Filters, ${alumniFilterCount} set`
                    : "Filters"
                }
                label={
                  alumniFilterCount > 0
                    ? `Filters · ${alumniFilterCount}`
                    : "Filters"
                }
                on={filtersOpen}
                quiet
                onPress={() => setFiltersOpen((open) => !open)}
              />
            ) : (
              <>
                <Chip
                  accessibilityRole="button"
                  accessibilityState={{}}
                  accessibilityLabel={
                    activesFilterCount > 0
                      ? `Filters, ${activesFilterCount} set`
                      : "Filters"
                  }
                  accessibilityHint={
                    showsPhoneReach
                      ? "Narrows actives by status, phone app, graduation year, class or role."
                      : "Narrows actives by status, graduation year, class or role."
                  }
                  label={
                    activesFilterCount > 0
                      ? `Filters · ${activesFilterCount}`
                      : "Filters"
                  }
                  on={activesFilterCount > 0}
                  quiet
                  onPress={() => activesFilterSheetRef.current?.present()}
                />
                {orderOffered ? (
                  <Chip
                    accessibilityRole="button"
                    accessibilityState={{ selected: sortByOrder }}
                    accessibilityLabel={`Sort by ${orderTerm}`}
                    accessibilityHint={
                      sortByOrder
                        ? "Lists actives by name again."
                        : "Lists actives oldest class first, then by number."
                    }
                    // "Sort:" leads, because beside Actives and Alumni a chip
                    // reading only the chapter's word looks like a third tab.
                    label={`Sort: ${orderTerm}`}
                    on={sortByOrder}
                    quiet
                    onPress={() => setSortByOrder((on) => !on)}
                  />
                ) : null}
              </>
            )
          }
        />
      )}

      {isSearching || tab !== "alumni" || !filtersOpen ? null : (
        <View style={styles.alumniFilters}>
          <SearchField
            value={alumniFilterInputs.gradYear}
            onChangeText={(next) =>
              setAlumniFilterInputs((f) => ({ ...f, gradYear: next }))
            }
            placeholder="Graduation year, e.g. 2018"
            accessibilityLabel="Filter alumni by graduation year"
            keyboardType="number-pad"
          />
          <SearchField
            value={alumniFilterInputs.city}
            onChangeText={(next) =>
              setAlumniFilterInputs((f) => ({ ...f, city: next }))
            }
            placeholder="City"
            accessibilityLabel="Filter alumni by city"
            autoCapitalize="words"
          />
          <SearchField
            value={alumniFilterInputs.company}
            onChangeText={(next) =>
              setAlumniFilterInputs((f) => ({ ...f, company: next }))
            }
            placeholder="Company"
            accessibilityLabel="Filter alumni by company"
            autoCapitalize="words"
          />
        </View>
      )}
      {phoneReachLine ? (
        <Text accessibilityLiveRegion="polite" style={styles.reachLine}>
          {phoneReachLine}
        </Text>
      ) : null}
    </View>
  );

  function renderBody() {
    if (!chapterId) return <NoChapterState noun="the member directory" />;
    if (activeQuery.isError && activeQuery.data === undefined) {
      return (
        <ErrorState
          title={DIRECTORY_COPY.loadError}
          body={describeLoadFailure(activeQuery.error)}
          onRetry={() => void activeQuery.refetch()}
          isRetrying={activeQuery.isFetching}
        />
      );
    }
    // Empty-states plan rule 7: one line where the rows would be, with the
    // way back out of a search or a filter as its link (writing.md § Members).
    if (isSearching) {
      return (
        <InlineNote
          action={{ label: "Clear search", onPress: () => setQuery("") }}
        >
          {directoryNoSearchMatches(deferredQuery)}
        </InlineNote>
      );
    }
    if (tab === "alumni" && hasAlumniFilters) {
      return (
        <InlineNote
          action={{
            label: "Clear filters",
            onPress: () =>
              setAlumniFilterInputs({ gradYear: "", city: "", company: "" }),
          }}
        >
          {DIRECTORY_COPY.alumniNoFilterMatches}
        </InlineNote>
      );
    }
    if (tab === "actives" && activesFilterCount > 0) {
      return (
        <InlineNote
          action={{
            label: "Clear filters",
            onPress: () => setActivesFilterPicks(NO_ACTIVES_FILTER),
          }}
        >
          {DIRECTORY_COPY.activesNoFilterMatches}
        </InlineNote>
      );
    }
    return (
      <InlineNote>
        {tab === "actives"
          ? DIRECTORY_COPY.activesEmpty
          : DIRECTORY_COPY.alumniEmpty}
      </InlineNote>
    );
  }

  return (
    <View style={styles.safeArea}>
      {/* First in the tree, as `ScreenShell` places it, so a screen reader
          reaches it without swiping past every row. */}
      {canInvite && chapterId ? (
        <FloatingCreateButton
          label="Invite members"
          hint="Opens invites to email or share with new members."
          onPress={() =>
            router.push({ pathname: "/invite", params: { from: "directory" } })
          }
        />
      ) : null}
      {/* Every edge: the tab layout draws no navigator header (#2485), so the
        list's own title is the top of the screen. */}
      <SafeAreaView
        style={styles.safeArea}
        edges={["top", "left", "right", "bottom"]}
      >
        {/* Pinned, as every screen's back capsule is (`ScreenShell`), inside an
          unpadded View so it sits where the content starts. */}
        <View style={styles.listFrame}>
          <PinnedBackRow back={BACK_TO_YOU} />
          <ScreenReady ready={!chapterId || !activeQuery.isPending} />
          <FlatList<DirectoryRow>
            data={rows}
            keyExtractor={(item) => item.userId}
            ListHeaderComponent={header}
            ListEmptyComponent={
              // The skeleton stands in for the rows themselves, so it takes no
              // inset: the empty and error cards do.
              !!chapterId && activeQuery.isPending ? (
                <MemberListSkeleton
                  label={
                    // A search looks across both lists and hides the tabs, so it
                    // names neither tab's list.
                    isSearching
                      ? "Searching chapter members"
                      : tab === "alumni"
                        ? "Loading alumni directory"
                        : "Loading chapter members"
                  }
                />
              ) : (
                <View style={styles.emptyWrap}>{renderBody()}</View>
              )
            }
            renderItem={({ item }) => (
              <MemberRow
                row={item}
                reach={rowReach(item.userId)}
                avatarTint={avatarTintFor(item.userId)}
                onPress={() =>
                  router.push({
                    pathname: "/member",
                    params: { userId: item.userId },
                  })
                }
              />
            )}
            contentContainerStyle={[
              styles.content,
              // Clear of the floating tab bar (`lib/floating-chrome.tsx`).
              {
                paddingBottom:
                  tokens.spacing.xl +
                  tabBarClearance +
                  // The last row clears the + too, as `ScreenShell` pads for it.
                  (canInvite ? CREATE_BUTTON_SIZE + FLOATING_TAB_BAR.gap : 0),
              },
            ]}
            keyboardShouldPersistTaps="handled"
            refreshControl={<ThemedRefreshControl refresh={refresh} />}
          />
        </View>
        <PickRolesSheet ref={pickRolesSheetRef} roles={pickable.roles} />
        <ActivesFilterSheet
          ref={activesFilterSheetRef}
          filter={activesFilter}
          onChange={setActivesFilterPicks}
          roles={filterRoles}
          years={yearOptions}
          classes={pledgeClasses ?? []}
          classWord={classTerm}
          // Data first: a failed refresh keeps the list it already read.
          rolesStatus={
            rolesQuery.data !== undefined
              ? "ready"
              : rolesQuery.isError
                ? "error"
                : "loading"
          }
          onRetryRoles={() => void rolesQuery.refetch()}
          showPhoneReach={showsPhoneReach}
        />
      </SafeAreaView>
    </View>
  );
}

/**
 * A row's accessible name: who, their presence and custom status when known,
 * then the meta line.
 */
export function memberPressLabel(
  row: DirectoryRow,
  presence: MemberPresence = NO_PRESENCE,
  reach?: PhoneReach,
): string {
  return [
    `View ${row.displayName}'s profile`,
    presence.status ? presenceLabel(presence.status) : null,
    presence.line,
    row.meta,
    reach ? phoneReachStateLabel(reach.state) : null,
    reach ? phoneReachStaleNote(reach) : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Exported so a spec can assert on a row directly: `vitest.setup.ts` renders
 * `FlatList` as a string stand-in that never invokes `renderItem`.
 */
export function MemberRow({
  row,
  avatarTint,
  onPress,
  reach,
}: {
  row: DirectoryRow;
  /**
   * The Phone app filter's answer for this member, drawn at the row's end
   * only while that filter is set (web draws it the same way).
   */
  reach?: PhoneReach;
  /** The member's initials paint (#3860); omit for the neutral circle. */
  avatarTint?: MemberAvatarTint | null;
  onPress?: () => void;
}) {
  // Their dot and custom status line (#4137), read for this row alone
  // (#4633): nothing until presence has synced, never a stand-in Offline.
  const presence = usePresenceOf(row.userId);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const feedback = usePressFeedback();

  return (
    <Pressable
      // A `Pressable` collapses its children into one accessibility node, so
      // the meta line (role/company/city/grad-year) a sighted user still
      // sees below the name would otherwise go unannounced entirely — the
      // label has to carry it explicitly rather than relying on the nested
      // `Text` nodes.
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={
        onPress ? memberPressLabel(row, presence, reach) : undefined
      }
      onPress={onPress}
      android_ripple={onPress ? feedback.ripple : undefined}
      style={({ pressed }) => [
        styles.row,
        onPress ? feedback.lift(pressed) : null,
      ]}
    >
      <AvatarWithPresence
        status={presence.status}
        avatarSize={AVATAR_SIZE}
        ring={tokens.color.surface.background}
      >
        <MemberAvatar
          uri={row.avatarUrl}
          initials={row.initials}
          size={AVATAR_SIZE}
          tint={avatarTint}
          style={styles.avatar}
          textStyle={styles.avatarText}
        />
      </AvatarWithPresence>
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{row.displayName}</Text>
        {/* The custom status line under the name, one line, as web's
            Directory row draws it (`components.md` § Chat member list). */}
        {presence.line ? (
          <Text numberOfLines={1} style={styles.rowStatusLine}>
            {presence.line}
          </Text>
        ) : null}
        {row.meta ? <Text style={styles.rowMeta}>{row.meta}</Text> : null}
        {reach && phoneReachStaleNote(reach) ? (
          <Text style={styles.rowMeta}>{phoneReachStaleNote(reach)}</Text>
        ) : null}
      </View>
      {reach ? (
        <Text
          style={[
            styles.rowReach,
            reach.state === "off"
              ? { color: tokens.color.semantic.warning }
              : null,
          ]}
        >
          {phoneReachStateLabel(reach.state)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Name widths, cycled, so the placeholder roster doesn't read as a grid. */
const SKELETON_NAME_WIDTHS = [
  "46%",
  "34%",
  "52%",
  "40%",
  "30%",
  "44%",
] as const;

/**
 * The roster's loading state: member rows on {@link MemberRow}'s own styles,
 * an avatar-sized circle and the name and meta lines, split by the same
 * hairlines, so the real rows land in place.
 */
export function MemberListSkeleton({
  label,
  rows = 6,
}: {
  /** writing.md §7's string for the tab that is loading. */
  label: string;
  rows?: number;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { role } = tokens.typography;

  return (
    <SkeletonRegion label={label} flush>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.row}>
          <SkeletonBlock
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            radius={avatarRadius(AVATAR_SIZE)}
          />
          <View style={styles.rowText}>
            <SkeletonText
              role={role.label}
              width={SKELETON_NAME_WIDTHS[index % SKELETON_NAME_WIDTHS.length]!}
            />
            <SkeletonText role={role.caption} width="28%" />
          </View>
        </View>
      ))}
    </SkeletonRegion>
  );
}

/** How many of the alumni filters hold a value: a new key counts with no edit here. */
function countSetFilters(filters: Record<string, string | undefined>): number {
  return Object.values(filters).filter(Boolean).length;
}

/** Rows the directory would draw, without the map-and-sort of a full select. */
function countMembers(data: unknown): number {
  return records(data).filter((row) => str(row, "user_id")).length;
}

/** The member row's avatar, which its skeleton draws at the same size. */
const AVATAR_SIZE = 40;

function createStyles(tokens: SignetTokens) {
  const avatarSize = AVATAR_SIZE;
  return StyleSheet.create({
    listFrame: {
      flex: 1,
    },
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    content: {
      width: "100%",
      maxWidth: 880,
      alignSelf: "center",
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    header: {
      paddingTop: tokens.spacing.lg,
      gap: tokens.spacing.sm,
      paddingBottom: tokens.spacing.sm,
    },
    alumniFilters: {
      gap: tokens.spacing.sm,
    },
    // ScreenShell's own title style: this screen draws its own header only
    // because its body is a FlatList.
    // Shrinks before the Add roles chip beside it does.
    title: { ...screenTitleStyle(tokens), flexShrink: 1 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      // A square row: hairlines split the list, so no radius.
      ...gutterBleed(tokens, { rounded: false }),
      minHeight: tokens.touch.minimum,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    avatar: {
      width: avatarSize,
      height: avatarSize,
      borderRadius: avatarRadius(avatarSize),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    rowText: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    rowName: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    rowMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    reachLine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    rowReach: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      flexShrink: 0,
    },
    // The status line reads before the meta line: mutedForeground, one
    // step up the ladder, as the member profile and web draw it.
    rowStatusLine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
    },
    titleActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    emptyWrap: {
      paddingTop: tokens.spacing.md,
    },
  });
}
