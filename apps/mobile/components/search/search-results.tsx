import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SignetTokens } from "@repo/theme/signet";
import {
  buildFindResults,
  isSearchRunnable,
  useChannels,
  useCurrentChapter,
  useSearch,
  type FindFilter,
  type FindGroup,
  type FindResult,
} from "@repo/hooks";
import { useDebouncedValue } from "@repo/hooks/use-debounced-value";
import { isModuleEnabled } from "@repo/validation";
import { findTargetRoute } from "@/lib/search/find-route";
import { isDirectChannel, selectChannels } from "@/lib/chat/channel-list";
import type { NotificationTarget } from "@/lib/notifications/targets";
import { selectionHaptic } from "@/lib/haptics";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The rows of the phone's Search screen (#5139, `app/(app)/search.tsx`): the
 * channels, members, messages and events that match what is typed, under
 * their group, off the same list web's Find dialog builds (`@repo/hooks`
 * `find-results.ts`). Five a group under All and up to ten once a chip
 * narrows it, the dialog's own caps. A tap opens the thing.
 *
 * From #4904 until #5139 this list sat inside Ask Frapp's sheet, three a group
 * between the thread and the field, and was the phone's only search, so a
 * member without Ask had none. It moved to a screen of its own; the Ask sheet
 * only asks.
 *
 * **Nothing blinks.** The rows of the last settled search stay until the next
 * one settles, so the list changes once per pause in typing and never flickers
 * to empty in between. Three characters start it, the search's own floor
 * (`isSearchRunnable`); below that the screen shows its recent searches
 * instead. A settled search with nothing in it says so, and one that failed
 * says that, never "no matches".
 *
 * Backwork has no screen on the phone, so its group is never listed; Events
 * is listed only while the chapter has the module on, as on web. A DM's
 * stored name is not what its row shows, so only channels match by name.
 */

const DEBOUNCE_MS = 200;
const NONE: readonly SearchRow[] = [];

export type SearchRow = FindResult & { route: NotificationTarget };

/** Under a settled search that found nothing. */
export function noSearchMatches(query: string): string {
  return `Nothing matches “${query}”.`;
}

export const SEARCH_FAILED = "Search didn't go through. Try again.";

/** The groups the screen's chips narrow to, in the list's order. */
export function useSearchGroups(): readonly FindGroup[] {
  const modules = useCurrentChapter().data?.enabled_modules;
  return useMemo(
    () =>
      isModuleEnabled(modules, "events")
        ? (["Channels", "Members", "Messages", "Events"] as const)
        : (["Channels", "Members", "Messages"] as const),
    [modules],
  );
}

export function SearchResults({
  query,
  filter,
  onOpen,
}: {
  /** What is in the field now. */
  query: string;
  /** All, or the group a chip narrowed the list to. */
  filter: FindFilter;
  /** The member tapped a row. */
  onOpen: (row: SearchRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const typed = query.trim();
  const debounced = useDebouncedValue(typed, DEBOUNCE_MS);
  const runnable = isSearchRunnable(typed);
  const search = useSearch(debounced);
  const channels = useChannels();
  const groups = useSearchGroups();
  const payload = search.data?.payload;

  const named = useMemo(
    () =>
      selectChannels(channels.data).filter(
        (channel) => !channel.hidden && !isDirectChannel(channel),
      ),
    [channels.data],
  );

  const hiddenGroups = useMemo(() => {
    const hidden = new Set<FindGroup>(["Backwork"]);
    if (!groups.includes("Events")) hidden.add("Events");
    return hidden;
  }, [groups]);

  const settling =
    runnable && (debounced !== typed || search.isPending || search.isFetching);
  const found = useMemo((): readonly SearchRow[] => {
    if (!runnable || settling) return NONE;
    return buildFindResults({
      query: debounced,
      filter,
      channels: named,
      payload,
      hiddenGroups,
    }).flatMap((result) => {
      const route = findTargetRoute(result.target);
      return route ? [{ ...result, route }] : [];
    });
  }, [runnable, settling, debounced, filter, named, payload, hiddenGroups]);

  // The last settled list stays up while the next search is out; it is kept
  // with the filter it was built for, so a chip tap redraws at once. A field
  // too short to search clears it.
  const [shown, setShown] = useState<{
    rows: readonly SearchRow[];
    settled: boolean;
  }>({ rows: NONE, settled: false });
  const next = !runnable
    ? { rows: NONE, settled: false }
    : settling
      ? shown
      : { rows: found, settled: true };
  if (next.rows !== shown.rows || next.settled !== shown.settled) {
    setShown(next);
  }

  if (!runnable) return null;

  if (shown.rows.length === 0) {
    if (!shown.settled) return null;
    return (
      <Text style={styles.note} accessibilityLiveRegion="polite">
        {search.isError ? SEARCH_FAILED : noSearchMatches(debounced)}
      </Text>
    );
  }

  return (
    <View testID="search-results">
      {shown.rows.map((row, index) => (
        <View key={row.id}>
          {shown.rows[index - 1]?.group !== row.group ? (
            <Text accessibilityRole="header" style={styles.group}>
              {row.group}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              row.hint ? `${row.label}, ${row.hint}` : row.label
            }
            accessibilityHint="Opens it."
            onPress={() => {
              selectionHaptic();
              onOpen(row);
            }}
            style={({ pressed }) => [
              styles.row,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.label} numberOfLines={1}>
              {row.group === "Channels" ? `#${row.label}` : row.label}
            </Text>
            {row.hint ? (
              <Text style={styles.hint} numberOfLines={1}>
                {row.hint}
              </Text>
            ) : null}
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    group: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.mutedForeground,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
    },
    row: {
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    pressed: { opacity: 0.7 },
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
    note: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingTop: tokens.spacing.md,
    },
  });
}
