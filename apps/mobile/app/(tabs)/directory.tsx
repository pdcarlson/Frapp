import { useDeferredValue, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
  useAlumni,
  useMemberSearch,
  useMembers,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  EmptyState,
  ErrorState,
  NoChapterState,
  SkeletonLines,
} from "@/components/state-block";
import { BACK_TO_MORE, BackRow } from "@/components/back-row";
import { Chip, FilterChips, SearchField } from "@/components/filter-chips";
import { usePressFeedback } from "@/components/list-section";
import { DirectoryGlyph } from "@/components/more/more-glyphs";
import { SearchGlyph } from "@/components/search-glyph";
import { MemberDetailSheet } from "@/components/directory/member-detail-sheet";
import {
  type DirectoryRow,
  selectActives,
  selectDirectoryRows,
} from "@/lib/more/directory";
import { records, str } from "@/lib/more/narrow";
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
 * `app/(tabs)/_layout.tsx` is frozen, and a `Tabs.Screen` needs a backing
 * file. `MemberDetailSheet` reaches the same fields
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
 */
type Tab = "actives" | "alumni";

export default function DirectoryScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const chapterId = useActiveChapterId();
  const detailSheetRef = useRef<BottomSheetModal>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

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
  // three parallel `useState`s, so `hasAlumniFilters` and the `useAlumni` call
  // below can both derive from the exact same value instead of two
  // hand-written copies of "is any filter set" drifting apart.
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
  const alumniFilterCount = Object.values(alumniFilters).filter(Boolean).length;
  const hasAlumniFilters = Boolean(
    deferredAlumniFilters.graduation_year ||
    deferredAlumniFilters.city ||
    deferredAlumniFilters.company,
  );

  const membersQuery = useMembers();
  const alumniQuery = useAlumni(deferredAlumniFilters);
  const searchQuery = useMemberSearch(deferredQuery);

  const isSearching = deferredQuery.length > 0;
  const activeQuery = isSearching
    ? searchQuery
    : tab === "actives"
      ? membersQuery
      : alumniQuery;

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
    <View style={styles.header}>
      {/* One block, so the header's gap doesn't widen the space under the
          back row past the shell's (`components/screen-shell.tsx`). */}
      <View>
        <BackRow {...BACK_TO_MORE} />
        <Text accessibilityRole="header" style={styles.title}>
          Directory
        </Text>
      </View>

      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name"
        accessibilityLabel="Search the directory"
      />

      {isSearching ? null : (
        <FilterChips
          accessibilityLabel="Actives or alumni"
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
    if (activeQuery.isPending) return <SkeletonLines lines={4} showTile />;
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
    if (isSearching) {
      return (
        <EmptyState
          glyph={SearchGlyph}
          title="No matches"
          body={`Nobody in this chapter matches “${deferredQuery}”.`}
        />
      );
    }
    // writing.md § Alumni's no-results row, with "filter" for its "field":
    // the fields are behind a chip named Filters here.
    if (tab === "alumni" && hasAlumniFilters) {
      return (
        <EmptyState
          glyph={SearchGlyph}
          title="No alumni match the filters"
          body="Clear a filter to see more."
        />
      );
    }
    // A title alone: there is nothing to do about an empty roster from here.
    return (
      <EmptyState
        glyph={DirectoryGlyph}
        title={tab === "actives" ? "No actives yet" : "No alumni yet"}
      />
    );
  }

  return (
    // Every edge: the tab layout draws no navigator header (#2485), so the
    // list's own title is the top of the screen.
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <FlatList
        data={rows}
        keyExtractor={(row) => row.userId}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>{renderBody()}</View>
        }
        renderItem={({ item }) => (
          <MemberRow
            row={item}
            onPress={() => {
              setSelectedUserId(item.userId);
              detailSheetRef.current?.present();
            }}
          />
        )}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
      <MemberDetailSheet
        ref={detailSheetRef}
        userId={selectedUserId}
        onDismiss={() => setSelectedUserId(null)}
      />
    </SafeAreaView>
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
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{row.initials}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{row.displayName}</Text>
        {row.meta ? <Text style={styles.rowMeta}>{row.meta}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Rows the directory would draw, without the map-and-sort of a full select. */
function countMembers(data: unknown): number {
  return records(data).filter((row) => str(row, "user_id")).length;
}

function createStyles(tokens: SignetTokens) {
  const avatarSize = 40;
  return StyleSheet.create({
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
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
      letterSpacing: -0.4,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      // Pads itself by `sm` and bleeds that `sm` into the screen gutter, as
      // Chat home's channel rows do: the avatar and text stay on the gutter
      // line, and the ripple and lift clear them instead of stopping flush.
      paddingHorizontal: tokens.spacing.sm,
      marginHorizontal: -tokens.spacing.sm,
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
