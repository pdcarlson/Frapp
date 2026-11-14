import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import type { SignetTokens } from "@repo/theme/signet";
import {
  buildFindResults,
  isSearchRunnable,
  useChannels,
  useCurrentChapter,
  useSearch,
  type FindGroup,
  type FindResult,
} from "@repo/hooks";
import { useDebouncedValue } from "@repo/hooks/use-debounced-value";
import { isModuleEnabled } from "@repo/validation";
import { findTargetRoute } from "@/lib/ask/find-route";
import { isDirectChannel, selectChannels } from "@/lib/chat/channel-list";
import type { NotificationTarget } from "@/lib/notifications/targets";
import { selectionHaptic } from "@/lib/haptics";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The search half of the phone's one field (#4904; Paul's pick of
 * 2026-11-13, "double down on the search and ask"): while a member types in
 * Ask Frapp's field, the channels, members, messages and events that match
 * are listed just above it. A tap opens the thing; Send still asks Frapp.
 * The Google app, Arc Search and Perplexity all work this way on a phone:
 * one field, places to go while typing, an answer on Send. Web's field does
 * the same from its Find dialog (`apps/web/components/layout/find-dialog.tsx`),
 * off the same list (`@repo/hooks` `find-results.ts`).
 *
 * **It lies over the thread, and moves nothing.** The list hangs from the
 * composer's top edge, over the bottom of the thread, so the thread is not
 * laid out again each time a result arrives. Nothing is drawn while a search
 * is out: the rows of the last settled search stay until the next one
 * settles, so the list changes once per pause in typing and never flickers
 * to empty in between. Three characters start it, the search's own floor
 * (`isSearchRunnable`); with nothing found there is no list at all, since
 * the field's other job, asking, is still right there.
 *
 * Up to three rows a group. It is a shortlist between a thread and a
 * keyboard; the dialog on web has the room for more.
 *
 * Backwork has no screen on the phone, so its group is never listed; Events
 * is listed only while the chapter has the module on, as on web.
 */

const GROUP_LIMIT = 3;
const DEBOUNCE_MS = 200;
const NONE: readonly AskFindRow[] = [];

export type AskFindRow = FindResult & { route: NotificationTarget };

export function AskFind({
  query,
  onOpen,
}: {
  /** What is in the field now. */
  query: string;
  /** The member tapped a row: close what is open and go there. */
  onOpen: (route: NotificationTarget) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const typed = query.trim();
  const debounced = useDebouncedValue(typed, DEBOUNCE_MS);
  const runnable = isSearchRunnable(typed);
  const search = useSearch(debounced);
  const channels = useChannels();
  const modules = useCurrentChapter().data?.enabled_modules;
  const payload = search.data?.payload;

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

  const settling =
    runnable && (debounced !== typed || search.isPending || search.isFetching);
  const found = useMemo((): readonly AskFindRow[] => {
    if (!runnable || settling) return NONE;
    return buildFindResults({
      query: debounced,
      filter: "All",
      channels: named,
      payload,
      hiddenGroups,
      groupLimit: GROUP_LIMIT,
    }).flatMap((result) => {
      const route = findTargetRoute(result.target);
      return route ? [{ ...result, route }] : [];
    });
  }, [runnable, settling, debounced, named, payload, hiddenGroups]);

  // The last settled list stays up while the next search is out. A field
  // too short to search clears it at once.
  const [rows, setRows] = useState<readonly AskFindRow[]>(NONE);
  const next = !runnable ? NONE : settling ? rows : found;
  if (next !== rows) setRows(next);

  if (rows.length === 0) return null;

  return (
    <View style={styles.panel} testID="ask-find">
      <BottomSheetScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
      >
        {rows.map((row, index) => (
          <View key={row.id}>
            {rows[index - 1]?.group !== row.group ? (
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
                onOpen(row.route);
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
      </BottomSheetScrollView>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    panel: {
      // Hangs from the composer's top edge, over the thread.
      position: "absolute",
      left: 0,
      right: 0,
      bottom: "100%",
      maxHeight: 264,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.background,
    },
    list: {
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
    },
    group: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.mutedForeground,
      paddingTop: tokens.spacing.sm,
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
  });
}
