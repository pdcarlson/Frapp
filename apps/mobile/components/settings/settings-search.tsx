import { useMemo, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import {
  SETTINGS_SEARCH_COPY,
  type SettingPhoneScreen,
} from "@repo/hooks/settings-search";
import type { SignetTokens } from "@repo/theme/signet";
import { SearchField } from "@/components/filter-chips";
import { ListRow, ListSection } from "@/components/list-section";
import { selectionHaptic } from "@/lib/haptics";
import {
  openSetting,
  usePhoneSettingsSearch,
} from "@/lib/settings/settings-search";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The search atop the phone's Chapter settings and Settings: web's field
 * (`apps/web/components/settings/settings-search.tsx`) in the iOS Settings
 * shape, where typing swaps the screen's rows for the matches and clearing
 * the field brings them back. `useSettingsSearchField` holds the words; the
 * screen draws `field` first and, while `searching`, `results` in place of
 * its rows.
 *
 * A match on this screen is lit in place (`jumpHere`); one on the other
 * settings screen opens it, lit; one only web changes opens the dashboard
 * in the browser, and says so under its name.
 */
export function useSettingsSearchField({
  here,
  jumpHere,
}: {
  here: SettingPhoneScreen;
  jumpHere: (settingId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const typed = query.trim();

  const field = (
    <SearchField
      value={query}
      onChangeText={setQuery}
      placeholder={SETTINGS_SEARCH_COPY.placeholder}
      accessibilityLabel={SETTINGS_SEARCH_COPY.placeholder}
      searchGlyph
    />
  );

  // Mounted only once something is typed, so a screen nobody searches reads
  // nothing for it.
  const results = typed ? (
    <SettingsSearchResults
      query={typed}
      here={here}
      jumpHere={jumpHere}
      onOpenedHere={() => setQuery("")}
    />
  ) : null;

  return { field, results, searching: typed !== "" };
}

function SettingsSearchResults({
  query,
  here,
  jumpHere,
  onOpenedHere,
}: {
  query: string;
  here: SettingPhoneScreen;
  jumpHere: (settingId: string) => void;
  onOpenedHere: () => void;
}) {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const find = usePhoneSettingsSearch();
  const matches = useMemo(() => find(query), [find, query]);
  const [browserFailed, setBrowserFailed] = useState(false);

  if (matches.length === 0) {
    return (
      <Text accessibilityLiveRegion="polite" style={styles.status}>
        {SETTINGS_SEARCH_COPY.none}
      </Text>
    );
  }
  return (
    <>
      <ListSection>
        {matches.map((match) => (
          <ListRow
            key={match.entry.id}
            label={match.entry.label}
            description={
              match.opensHere
                ? match.hint
                : `${match.hint}. ${SETTINGS_SEARCH_COPY.onWeb}`
            }
            accessibilityHint={
              match.opensHere
                ? "Opens the setting."
                : "Opens the web dashboard in your browser."
            }
            onPress={() => {
              selectionHaptic();
              setBrowserFailed(false);
              if (match.opensHere) onOpenedHere();
              openSetting(router, match.entry, {
                here,
                jumpHere,
                onBrowserFailed: () => setBrowserFailed(true),
              });
            }}
          />
        ))}
      </ListSection>
      {browserFailed ? (
        <Text style={styles.error}>{SETTINGS_SEARCH_COPY.browserFailed}</Text>
      ) : null}
    </>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    status: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingTop: tokens.spacing.md,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
