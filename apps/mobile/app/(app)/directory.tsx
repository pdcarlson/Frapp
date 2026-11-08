import { useDeferredValue, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
  useAlumni,
  useMemberSearch,
  useMembers,
  usePermissionList,
} from "@repo/hooks";
import { useRouter } from "expo-router";
import { can } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { MemberAvatar } from "@/components/member-avatar";
import {
  ErrorState,
  NoChapterState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import {
  BACK_TO_MORE,
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
import { MemberDetailSheet } from "@/components/directory/member-detail-sheet";
import {
  type DirectoryRow,
  selectActives,
  selectDirectoryRows,
} from "@/lib/more/directory";
import { records, str } from "@/lib/more/narrow";
import { FLOATING_TAB_BAR, useTabBarClearance } from "@/lib/floating-chrome";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

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
 * ## Rows open a member detail sheet, not a route
 *
 * Canvas draws a chevron on each row, and a new route file is not an option:
 * the route layouts are frozen (`spec/ui/mobile/navigation.md` § Hotspot
 * freeze). `MemberDetailSheet` reaches the same fields
 * `spec/behavior/members.md`'s detail view specifies (name, email, role,
 * joined date) via a `@gorhom/bottom-sheet`, the pattern `new-task-sheet.tsx`
 * established, without one. Still no chevron drawn: TODO-DESIGN tracks the
 * affordance, not the behavior.
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
 */
type Tab = "actives" | "alumni";

export default function DirectoryScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const tabBarClearance = useTabBarClearance();
  const chapterId = useActiveChapterId();
  const router = useRouter();
  const canInvite = can("members:invite", usePermissionList());
  const detailSheetRef = useRef<BottomSheetModal>(null);
  const [selected, setSelected] = useState<DirectoryRow | null>(null);

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
  const refresh = useRefetchAll([membersQuery, alumniQuery, searchQuery]);

  // `GET /v1/members` is the whole chapter; the Actives tab is the part of it
  // that isn't on the Alumni tab (#2484). Search stays directory-wide: it hides
  // the chips and looks across both lists.
  const actives = useMemo(
    () => selectActives(membersQuery.data),
    [membersQuery.data],
  );
  const listData =
    !isSearching && tab === "actives" ? actives : activeQuery.data;

  const rows = useMemo(() => selectDirectoryRows(listData), [listData]);
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
      <Text accessibilityRole="header" style={styles.title}>
        Directory
      </Text>

      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name"
        accessibilityLabel="Search the directory"
      />

      {isSearching ? null : (
        <FilterChips
          accessibilityLabel="Actives or alumni"
          scroll
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
                onPress={() => setFiltersOpen((open) => !open)}
              />
            ) : null
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
    </View>
  );

  function renderBody() {
    if (!chapterId) return <NoChapterState noun="the member directory" />;
    if (activeQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load the directory"
          body="The chapter roster couldn't reach the server."
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
          {`Nobody matches “${deferredQuery}”.`}
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
          No alumni match these filters.
        </InlineNote>
      );
    }
    return (
      <InlineNote>
        {tab === "actives"
          ? "No actives yet."
          : "No alumni yet. Graduated members appear here."}
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
          hint="Opens invite links to share with new members."
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
          <PinnedBackRow back={BACK_TO_MORE} />
          <FlatList
            data={rows}
            keyExtractor={(row) => row.userId}
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
                onPress={() => {
                  setSelected(item);
                  detailSheetRef.current?.present();
                }}
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
        <MemberDetailSheet
          ref={detailSheetRef}
          member={selected}
          onDismiss={() => setSelected(null)}
        />
      </SafeAreaView>
    </View>
  );
}

/**
 * Exported so a spec can assert on a row directly: `vitest.setup.ts` renders
 * `FlatList` as a string stand-in that never invokes `renderItem`.
 */
export function MemberRow({
  row,
  onPress,
}: {
  row: DirectoryRow;
  onPress?: () => void;
}) {
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
        onPress
          ? `View ${row.displayName}'s profile${row.meta ? `, ${row.meta}` : ""}`
          : undefined
      }
      onPress={onPress}
      android_ripple={onPress ? feedback.ripple : undefined}
      style={({ pressed }) => [
        styles.row,
        onPress ? feedback.lift(pressed) : null,
      ]}
    >
      <MemberAvatar
        uri={row.avatarUrl}
        initials={row.initials}
        size={AVATAR_SIZE}
        style={styles.avatar}
        textStyle={styles.avatarText}
      />
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{row.displayName}</Text>
        {row.meta ? <Text style={styles.rowMeta}>{row.meta}</Text> : null}
      </View>
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
    <SkeletonRegion label={label}>
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
    title: screenTitleStyle(tokens),
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
    emptyWrap: {
      paddingTop: tokens.spacing.md,
    },
  });
}
