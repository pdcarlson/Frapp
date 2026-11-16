import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { FindFilter } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { ASK_COPY, FIND_PLACEHOLDER } from "@repo/validation";
import { BACK_TO_CHAT } from "@/components/back-row";
import { FilterChips, SearchField } from "@/components/filter-chips";
import { FrappCrest } from "@/components/frapp-crest";
import { ScreenShell } from "@/components/screen-shell";
import {
  SearchResults,
  useSearchGroups,
  type SearchRow,
} from "@/components/search/search-results";
import { useAiSurfaces } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import { selectionHaptic } from "@/lib/haptics";
import { openNotificationTarget } from "@/lib/notifications/targets";
import { useRecentSearches } from "@/lib/search/recent-searches";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";

/** The Ask row's words: "Ask Frapp about “rush week”". */
export function askAboutLabel(query: string): string {
  return `${ASK_COPY.name} about “${query}”`;
}

export const RECENT_SEARCHES_HEADING = "Recent";
export const CLEAR_RECENT_SEARCHES = "Clear";

/**
 * Search (#5139, Paul's pick of option A on his 2026-11-16 proposal):
 * pushed from the round at the head of Chat home's title row, `‹ Chat`.
 * Until then the phone's only search was the list inside Ask Frapp's sheet
 * (#4904), so a member without Ask had none, and a search sat in the AI
 * conversation where Send asked Frapp instead of opening the thing.
 *
 * It opens with the field focused and the keyboard up, as Slack's and
 * Discord's search screens do. Under the field: chips All, Channels, Members,
 * Messages and Events (Events only while the chapter has the module), then
 * either this member's recent searches on this phone (`lib/search/
 * recent-searches.ts`) while fewer than three characters are typed, or the
 * results (`components/search/search-results.tsx`, web's Find list).
 *
 * For a member with Ask, the last row is "Ask Frapp about …", which opens the
 * Ask sheet with the words in its field to send or change (`ask.tsx`'s
 * `draft`). Without Ask it is not drawn, and search is all the same.
 */
export default function SearchScreen() {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { accent } = useChapterBranding();
  const router = useRouter();
  const hasAsk = useAiSurfaces().ask;
  const groups = useSearchGroups();
  const { recent, remember, clear } = useRecentSearches();

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<FindFilter>("All");
  // A chip for a group the chapter turned off falls back to All.
  const filter: FindFilter =
    picked !== "All" && !groups.includes(picked) ? "All" : picked;
  const typed = query.trim();

  // The keyboard comes up on arrival, and again on coming back to the screen
  // from a result, so the next search is one tap away.
  const fieldRef = useRef<TextInput>(null);
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => fieldRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }, []),
  );

  const open = useCallback(
    (row: SearchRow) => {
      remember(typed);
      openNotificationTarget(router, row.route);
    },
    [remember, router, typed],
  );

  const askAbout = useCallback(() => {
    selectionHaptic();
    remember(typed);
    router.push({ pathname: "/ask", params: { draft: typed } });
  }, [remember, router, typed]);

  const chips = useMemo(
    () => [
      { value: null, label: "All" },
      ...groups.map((group) => ({ value: group, label: group })),
    ],
    [groups],
  );

  return (
    <ScreenShell
      title="Search"
      back={BACK_TO_CHAT}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.top}>
        <SearchField
          inputRef={fieldRef}
          value={query}
          onChangeText={setQuery}
          placeholder={FIND_PLACEHOLDER}
          accessibilityLabel="Search"
          searchGlyph
          returnKeyType="search"
          onSubmitEditing={() => remember(typed)}
        />
        <FilterChips
          chips={chips}
          selected={filter === "All" ? null : filter}
          onSelect={(value) => setPicked((value as FindFilter | null) ?? "All")}
          accessibilityLabel="Search in"
          scroll
        />
      </View>

      {typed.length < 3 && recent.length > 0 ? (
        <View testID="recent-searches">
          <View style={styles.recentHeading}>
            <Text accessibilityRole="header" style={styles.group}>
              {RECENT_SEARCHES_HEADING}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear recent searches"
              hitSlop={12}
              onPress={clear}
            >
              <Text style={styles.clear}>{CLEAR_RECENT_SEARCHES}</Text>
            </Pressable>
          </View>
          {recent.map((entry) => (
            <Pressable
              key={entry}
              accessibilityRole="button"
              accessibilityLabel={entry}
              accessibilityHint="Searches for it again."
              onPress={() => setQuery(entry)}
              style={({ pressed }) => [
                styles.row,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.label} numberOfLines={1}>
                {entry}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <SearchResults query={query} filter={filter} onOpen={open} />

      {hasAsk && typed.length > 0 ? (
        <Pressable
          testID="search-ask-row"
          accessibilityRole="button"
          accessibilityLabel={askAboutLabel(typed)}
          accessibilityHint="Opens Ask Frapp with this in its field."
          onPress={askAbout}
          style={({ pressed }) => [
            styles.row,
            styles.askRow,
            pressed ? styles.pressed : null,
          ]}
        >
          <FrappCrest height={18} color={accent} />
          <Text style={styles.label} numberOfLines={1}>
            {askAboutLabel(typed)}
          </Text>
        </Pressable>
      ) : null}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    top: {
      gap: tokens.spacing.md,
      paddingBottom: tokens.spacing.sm,
    },
    recentHeading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    group: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.mutedForeground,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
    },
    clear: {
      ...typeRole(tokens.typography.role.caption),
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
    // Set apart from the results above it: a different thing to do.
    askRow: {
      marginTop: tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    pressed: { opacity: 0.7 },
    label: {
      flexShrink: 1,
      flexGrow: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
  });
}
