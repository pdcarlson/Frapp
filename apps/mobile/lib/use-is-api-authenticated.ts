import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { readAuthToken, subscribeToAuthToken } from "./auth-token";

/**
 * Whether the API SDK currently has a bearer token to send.
 *
 * Deliberately kept out of `frapp-client.tsx`: that module builds the provider
 * and therefore imports the Supabase auth session, which pulls in native
 * modules (`expo-linking`). Every consumer of this hook would inherit that
 * dependency for no reason — reading the token needs nothing but SecureStore.
 */
export function useIsApiAuthenticated(): boolean {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const refresh = async () => {
      try {
        const token = await readAuthToken();
        if (isMounted) setIsAuthenticated(!!token);
      } catch {
        if (isMounted) setIsAuthenticated(false);
      }
    };

    void refresh();

    // Sign-in and token refresh both happen while the app is open, so the
    // AppState listener alone would leave this stale until the next
    // background/foreground cycle.
    const unsubscribe = subscribeToAuthToken(() => {
      void refresh();
    });

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });

    return () => {
      isMounted = false;
      unsubscribe();
      subscription.remove();
    };
  }, []);

  return isAuthenticated;
}
