import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import { FrappColorMode, FrappTokens, getFrappTokens } from "@repo/theme/tokens";

const MOBILE_THEME_PREFERENCE_STORAGE_KEY = "frapp.mobile.theme-preference";

export type ThemePreference = "system" | "light" | "dark";

type FrappThemeContextValue = {
  themePreference: ThemePreference;
  resolvedTheme: FrappColorMode;
  tokens: FrappTokens;
  setThemePreference: (themePreference: ThemePreference) => void;
};

const FrappThemeContext = createContext<FrappThemeContextValue | null>(null);

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function FrappThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>("system");

  useEffect(() => {
    let isMounted = true;

    async function hydrateThemePreference() {
      try {
        const persistedThemePreference = await AsyncStorage.getItem(
          MOBILE_THEME_PREFERENCE_STORAGE_KEY,
        );

        if (!persistedThemePreference || !isMounted) {
          return;
        }

        if (isThemePreference(persistedThemePreference)) {
          setThemePreferenceState(persistedThemePreference);
        }
      } catch {
        // If loading fails, continue with system defaults.
      }
    }

    void hydrateThemePreference();

    return () => {
      isMounted = false;
    };
  }, []);

  const resolvedTheme: FrappColorMode =
    themePreference === "system"
      ? systemColorScheme === "dark"
        ? "dark"
        : "light"
      : themePreference;

  const tokens = useMemo(() => getFrappTokens(resolvedTheme), [resolvedTheme]);

  function setThemePreference(nextThemePreference: ThemePreference) {
    setThemePreferenceState(nextThemePreference);
    void AsyncStorage.setItem(
      MOBILE_THEME_PREFERENCE_STORAGE_KEY,
      nextThemePreference,
    );
  }

  const value = useMemo(
    () => ({
      themePreference,
      resolvedTheme,
      tokens,
      setThemePreference,
    }),
    [resolvedTheme, themePreference, tokens],
  );

  return (
    <FrappThemeContext.Provider value={value}>
      {children}
    </FrappThemeContext.Provider>
  );
}

export function useFrappTheme() {
  const context = useContext(FrappThemeContext);

  if (!context) {
    throw new Error("useFrappTheme must be used within FrappThemeProvider.");
  }

  return context;
}
