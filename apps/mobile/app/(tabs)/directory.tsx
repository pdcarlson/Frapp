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
import { FilterChips, SearchField } from "@/components/filter-chips";
import { MemberDetailSheet } from "@/components/directory/member-detail-sheet";
import { type DirectoryRow, selectDirectoryRows } from "@/lib/more/directory";
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

  const membersQuery = useMembers();
  const alumniQuery = useAlumni();
  const searchQuery = useMemberSearch(deferredQuery);

  const isSearching = deferredQuery.length > 0;
  const activeQuery = isSearching
    ? searchQuery
    : tab === "actives"
      ? membersQuery
      : alumniQuery;

  const rows = useMemo(
    () => selectDirectoryRows(activeQuery.data),
    [activeQuery.data],
  );
  // Counted, not selected: `selectDirectoryRows` maps and sorts, and sorting to
  // read a `.length` would run a full `localeCompare` sort over both lists on
  // every keystroke. `null` until the query succeeds, so a populated tab never
  // advertises "· 0" while it loads.
  const activesCount = useMemo(
    () => (membersQuery.isSuccess ? countMembers(membersQuery.data) : null),
    [membersQuery.isSuccess, membersQuery.data],
  );
  const alumniCount = useMemo(
    () => (alumniQuery.isSuccess ? countMembers(alumniQuery.data) : null),
    [alumniQuery.isSuccess, alumniQuery.data],
  );

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Directory</Text>
      <Text style={styles.subtitle}>Actives and alumni.</Text>

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
        />
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
          glyph="⌕"
          title="No matches"
          body={`Nobody in this chapter matches “${deferredQuery}”.`}
        />
      );
    }
    return (
      <EmptyState
        glyph="☺"
        title={tab === "actives" ? "No actives yet" : "No alumni yet"}
        body="Members appear here once they join the chapter."
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.userId}
        ListHeaderComponent={header}
        ListEmptyComponent={<View style={styles.emptyWrap}>{renderBody()}</View>}
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
      style={styles.row}
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
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
      letterSpacing: -0.4,
    },
    subtitle: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
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
