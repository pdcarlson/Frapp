import { useDeferredValue, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { useChapterBranding } from "@/lib/chapter-branding";
import { type DirectoryRow, selectDirectoryRows } from "@/lib/more/directory";
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
 * ## Rows do not navigate
 *
 * Canvas draws a chevron on each row. There is nowhere for it to go: a member
 * detail screen would need a new route file, and `app/(tabs)/_layout.tsx` is
 * frozen — a `Tabs.Screen` needs a backing file, so adding one is an integrator
 * change, not a screen slice. A chevron that does nothing is worse than no
 * chevron, so the rows are plain. TODO-DESIGN: member detail, as a sheet.
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
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const chapterId = useActiveChapterId();

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
  const activesCount = selectDirectoryRows(membersQuery.data).length;
  const alumniCount = selectDirectoryRows(alumniQuery.data).length;

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Directory</Text>
      <Text style={styles.subtitle}>Actives and alumni.</Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name"
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel="Search the directory"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />

      {isSearching ? null : (
        <View style={styles.chipRow}>
          {(
            [
              { key: "actives" as const, label: "Actives", count: activesCount },
              { key: "alumni" as const, label: "Alumni", count: alumniCount },
            ]
          ).map((chip) => {
            const selected = tab === chip.key;
            return (
              <Pressable
                key={chip.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setTab(chip.key)}
                style={[
                  styles.chip,
                  selected ? { backgroundColor: accent } : styles.chipIdle,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    selected ? styles.chipTextSelected : null,
                  ]}
                >
                  {chip.label} · {chip.count}
                </Text>
              </Pressable>
            );
          })}
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
        renderItem={({ item }) => <MemberRow row={item} />}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

/**
 * Exported so a spec can assert on a row directly: `vitest.setup.ts` renders
 * `FlatList` as a string stand-in that never invokes `renderItem`.
 */
export function MemberRow({ row }: { row: DirectoryRow }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{row.initials}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{row.displayName}</Text>
        {row.meta ? <Text style={styles.rowMeta}>{row.meta}</Text> : null}
      </View>
    </View>
  );
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
    search: {
      marginTop: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    chipRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.xs,
    },
    chip: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.lg,
      borderRadius: tokens.radius.chipLarge,
    },
    chipIdle: {
      backgroundColor: tokens.color.surface.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    chipText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    chipTextSelected: {
      color: tokens.color.gold.onHouse,
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
