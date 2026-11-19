import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TextInput } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { SignetTokens } from "@repo/theme/signet";
import {
  buildFindResults,
  isSearchRunnable,
  settingEntryById,
  SEARCH_MIN_QUERY_LENGTH,
  useActiveChapterId,
  useChannels,
  useCurrentChapter,
  useSearch,
  useViewerUserId,
  type FindFilter,
  type FindGroup,
  type FindResult,
} from "@repo/hooks";
import { useDebouncedValue } from "@repo/hooks/use-debounced-value";
import { ASK_COPY, isModuleEnabled } from "@repo/validation";
import { FilterChips, SearchField } from "@/components/filter-chips";
import { PressableRow } from "@/components/list-section";
import { FrappCrest } from "@/components/frapp-crest";
import { AskSheet } from "@/components/ask/ask-sheet";
import { useAiSurfaces } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import { isDirectChannel, selectChannels } from "@/lib/chat/channel-list";
import { selectionHaptic } from "@/lib/haptics";
import {
  openNotificationTarget,
  type NotificationTarget,
} from "@/lib/notifications/targets";
import { findTargetRoute } from "@/lib/search/find-route";
import {
  openSetting,
  usePhoneSettingsSearch,
} from "@/lib/settings/settings-search";
import {
  readRecentSearches,
  withRecentSearch,
  writeRecentSearches,
} from "@/lib/search/recent-searches";
import { fontFamilyFor, tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Search, the phone's own (#5139; Paul's pick of 2026-11-16, option A of
 * the proposal page https://claude.ai/artifact/BJHD8pewPWNQzpEzTt8KFW).
 *
 * Chat home's Search round pushes it (`app/(app)/search.tsx`, which draws
 * the shell around it). It opens with the field focused and
 * the keyboard up, so a tap and a few letters is the whole job, as Slack's
 * and iOS's search screens do. Before anything is typed it lists the
 * member's last few searches on this phone (`lib/search/recent-searches.ts`).
 *
 * **The rows are web's Find list** (`@repo/hooks` `buildFindResults`):
 * channels the member can read, members, messages and events, with the same
 * caps (five a group under All, all of them once a chip narrows it) and the
 * same words for a search that is still out, failed, timed out or found
 * nothing. A tap opens the thing (`lib/search/find-route.ts`) and keeps the
 * words as a recent search.
 *
 * **Every member has it.** Until #5139 the only search on the phone was the
 * list inside the Ask Frapp field (#4904), so a member without Ask had none.
 * For a member who has Ask, the list ends in one "Ask Frapp about …" row,
 * which opens the Ask sheet with the words in its field to send or change:
 * search may hand a question to Ask, but Ask no longer searches.
 *
 * **Settings** (2026-11-19) are the settings search's matches
 * (`lib/settings/settings-search.ts`), listed after Channels as on web; one
 * only web changes opens the dashboard in the browser.
 *
 * Backwork has no screen on the phone, so its group is never listed; Events
 * is listed only while the chapter has the module on, as on web.
 */

export const SEARCH_COPY = {
  title: "Search",
  placeholder: "Search your chapter",
  recent: "Recent",
  clearRecent: "Clear",
  tooShort: `Type at least ${SEARCH_MIN_QUERY_LENGTH} characters.`,
  searching: "Searching...",
  failed: "Search is unavailable right now. Try again in a moment.",
  timedOut: "Search took too long. Try a narrower term.",
  none: "No matches.",
  partial: (groups: readonly string[]) =>
    `Stopped looking in ${groups.join(", ")}. Results may be incomplete.`,
  partialUnnamed: "Some sources timed out. Results may be incomplete.",
  askAbout: (query: string) => `${ASK_COPY.name} about “${query}”`,
} as const;

const DEBOUNCE_MS = 200;

/** Which group a timed-out search source fills (`x-search-timeout-sources`). */
const GROUP_FOR_SOURCE: Record<string, FindGroup> = {
  backwork: "Backwork",
  events: "Events",
  members: "Members",
  messages: "Messages",
};

/** `route` is null only for a setting that opens on the web dashboard. */
type SearchRow = FindResult & { route: NotificationTarget | null };

/** What the Search screen draws inside its shell. */
export function SearchScreen() {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const router = useRouter();
  const { accent } = useChapterBranding();
  const hasAsk = useAiSurfaces().ask;

  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FindFilter>("All");

  // The keyboard comes up with the screen. A frame later, so the push has
  // a field to focus on every platform.
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  // ---- Recent searches ------------------------------------------------
  const viewerId = useViewerUserId();
  const chapterId = useActiveChapterId() ?? null;
  const [recent, setRecent] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!viewerId) return;
    let live = true;
    void readRecentSearches(viewerId, chapterId).then((stored) => {
      if (live) setRecent(stored);
    });
    return () => {
      live = false;
    };
  }, [viewerId, chapterId]);
  // Read, add, write: from what is stored, never from what is on screen,
  // which is empty until the first read answers. Adding to that would write
  // over the member's earlier searches on a slow cold start.
  const remember = useCallback(
    (words: string) => {
      if (!viewerId) return;
      void readRecentSearches(viewerId, chapterId).then((stored) => {
        const next = withRecentSearch(stored, words);
        writeRecentSearches(viewerId, chapterId, next);
        setRecent(next);
      });
    },
    [viewerId, chapterId],
  );
  const clearRecent = useCallback(() => {
    setRecent([]);
    if (viewerId) writeRecentSearches(viewerId, chapterId, []);
  }, [viewerId, chapterId]);

  // ---- The search -----------------------------------------------------
  const typed = query.trim();
  const debounced = useDebouncedValue(typed, DEBOUNCE_MS);
  const runnable = isSearchRunnable(typed);
  const search = useSearch(debounced);
  const channels = useChannels();
  const modules = useCurrentChapter().data?.enabled_modules;
  // Settings the member can change, by name or synonym (2026-11-19).
  const findSettings = usePhoneSettingsSearch();

  // A DM's stored name is not what its row shows, so only channels match.
  const named = useMemo(
    () =>
      selectChannels(channels.data).filter(
        (channel) => !channel.hidden && !isDirectChannel(channel),
      ),
    [channels.data],
  );
  const hiddenGroups = useMemo(() => {
    const hidden = new Set<FindGroup>(["Backwork"]);
    if (!isModuleEnabled(modules, "events")) hidden.add("Events");
    return hidden;
  }, [modules]);
  const chips = useMemo(
    () =>
      (
        [
          "All",
          "Channels",
          "Settings",
          "Members",
          "Messages",
          "Events",
        ] as const
      )
        .filter((group) => group === "All" || !hiddenGroups.has(group))
        .map((group) => ({ value: group, label: group })),
    [hiddenGroups],
  );
  // A chip for a group the chapter turned off reads as All.
  const shownFilter: FindFilter =
    filter !== "All" && hiddenGroups.has(filter) ? "All" : filter;

  // A search with no chapter to run in never starts, so it is not "nothing
  // found" either.
  const noChapter = chapterId === null;
  const settling =
    runnable &&
    !noChapter &&
    (debounced !== typed || search.isFetching || search.isPending);
  const rows = useMemo((): readonly SearchRow[] => {
    if (!runnable) return [];
    return buildFindResults({
      query: debounced,
      filter: shownFilter,
      channels: named,
      payload: search.data?.payload,
      hiddenGroups,
      settings: findSettings(debounced),
    }).flatMap((result): SearchRow[] => {
      const route = findTargetRoute(result.target);
      if (route) return [{ ...result, route }];
      // A setting only web changes is still listed, and opens the dashboard.
      return result.target.type === "setting"
        ? [{ ...result, route: null }]
        : [];
    });
  }, [
    runnable,
    debounced,
    shownFilter,
    named,
    search.data,
    hiddenGroups,
    findSettings,
  ]);

  // Web's rule (`find-dialog.tsx`): only a timeout in a group the member is
  // looking at counts, and one that cut a list short is said under the rows,
  // because "stopped looking" must never read as "found nothing"
  // (spec/behavior/search.md). Channels are matched here and never time out.
  const shownGroup = (group: FindGroup) =>
    !hiddenGroups.has(group) &&
    (shownFilter === "All" || shownFilter === group);
  const allTimedOut = search.data?.timedOutSources ?? [];
  const timedOutGroups = allTimedOut
    .map((source) => GROUP_FOR_SOURCE[source])
    .filter((group): group is FindGroup => !!group && shownGroup(group));
  const timedOut =
    allTimedOut.length > 0
      ? timedOutGroups.length > 0
      : (search.data?.timedOut ?? false) && shownFilter !== "Channels";

  let status: string | null = null;
  if (typed !== "" && !runnable) status = SEARCH_COPY.tooShort;
  else if (runnable && noChapter) status = SEARCH_COPY.failed;
  else if (runnable && settling && rows.length === 0)
    status = SEARCH_COPY.searching;
  else if (runnable && search.isError) status = SEARCH_COPY.failed;
  else if (runnable && !settling && rows.length === 0)
    status = timedOut ? SEARCH_COPY.timedOut : SEARCH_COPY.none;
  const partial =
    runnable && !settling && rows.length > 0 && timedOut
      ? timedOutGroups.length > 0
        ? SEARCH_COPY.partial(timedOutGroups)
        : SEARCH_COPY.partialUnnamed
      : null;

  const open = (row: SearchRow) => {
    selectionHaptic();
    // The rows are the settled search's, so its words are what led here.
    remember(debounced);
    if (row.route) {
      openNotificationTarget(router, row.route);
      return;
    }
    if (row.target.type === "setting") {
      const entry = settingEntryById(row.target.settingId);
      if (entry) openSetting(router, entry);
    }
  };

  // ---- Handing the words to Ask ---------------------------------------
  const askRef = useRef<BottomSheetModal>(null);
  const [askDraft, setAskDraft] = useState<string | null>(null);
  useEffect(() => {
    if (askDraft !== null) askRef.current?.present();
  }, [askDraft]);

  return (
    <>
      <SearchField
        inputRef={inputRef}
        value={query}
        onChangeText={setQuery}
        placeholder={SEARCH_COPY.placeholder}
        accessibilityLabel={SEARCH_COPY.placeholder}
        searchGlyph
      />

      {typed === "" ? (
        recent.length > 0 ? (
          <View testID="recent-searches">
            <View style={styles.headingRow}>
              <Text accessibilityRole="header" style={styles.heading}>
                {SEARCH_COPY.recent}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
                hitSlop={12}
                onPress={clearRecent}
              >
                <Text style={[styles.clear, { color: accent }]}>
                  {SEARCH_COPY.clearRecent}
                </Text>
              </Pressable>
            </View>
            {recent.map((words) => (
              <PressableRow
                key={words}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${words}`}
                onPress={() => setQuery(words)}
                style={styles.row}
              >
                <Text style={styles.label} numberOfLines={1}>
                  {words}
                </Text>
              </PressableRow>
            ))}
          </View>
        ) : null
      ) : (
        <>
          {runnable ? (
            <FilterChips
              scroll
              chips={chips}
              selected={shownFilter}
              onSelect={(value) =>
                setFilter((value as FindFilter | null) ?? "All")
              }
              accessibilityLabel="Show results from"
            />
          ) : null}
          {status ? (
            <Text accessibilityLiveRegion="polite" style={styles.status}>
              {status}
            </Text>
          ) : null}
          {partial ? <Text style={styles.status}>{partial}</Text> : null}
          <View testID="search-results">
            {rows.map((row, index) => (
              <View key={row.id}>
                {rows[index - 1]?.group !== row.group ? (
                  <Text accessibilityRole="header" style={styles.heading}>
                    {row.group}
                  </Text>
                ) : null}
                <PressableRow
                  accessibilityRole="button"
                  accessibilityLabel={
                    row.hint ? `${row.label}, ${row.hint}` : row.label
                  }
                  accessibilityHint={
                    row.route ? "Opens it." : "Opens the web dashboard."
                  }
                  onPress={() => open(row)}
                  style={styles.row}
                >
                  <Text style={styles.label} numberOfLines={1}>
                    {row.group === "Channels" ? `#${row.label}` : row.label}
                  </Text>
                  {row.hint ? (
                    <Text style={styles.hint} numberOfLines={1}>
                      {row.hint}
                    </Text>
                  ) : null}
                </PressableRow>
              </View>
            ))}
          </View>
          {hasAsk ? (
            <PressableRow
              testID="search-ask"
              accessibilityRole="button"
              accessibilityLabel={SEARCH_COPY.askAbout(typed)}
              accessibilityHint="Opens Ask Frapp with these words."
              onPress={() => {
                selectionHaptic();
                remember(typed);
                setAskDraft(typed);
              }}
              style={[
                styles.row,
                styles.askRow,
                { borderColor: tint(accent, 0.3) },
              ]}
            >
              <FrappCrest height={18} color={accent} />
              <Text style={[styles.label, { color: accent }]} numberOfLines={1}>
                {SEARCH_COPY.askAbout(typed)}
              </Text>
            </PressableRow>
          ) : null}
        </>
      )}

      {hasAsk && askDraft !== null ? (
        <AskSheet
          key={askDraft}
          ref={askRef}
          initialDraft={askDraft}
          onClosed={() => setAskDraft(null)}
        />
      ) : null}
    </>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    headingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    heading: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.mutedForeground,
      paddingTop: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xs,
    },
    clear: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      paddingTop: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xs,
    },
    status: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingTop: tokens.spacing.md,
    },
    row: {
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    askRow: {
      marginTop: tokens.spacing.lg,
      paddingHorizontal: tokens.spacing.md,
      borderWidth: 1,
      borderRadius: tokens.radius.card,
    },
    label: {
      flexShrink: 1,
      flexGrow: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    hint: {
      flexShrink: 0,
      maxWidth: "45%",
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
