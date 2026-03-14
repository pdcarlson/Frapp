"use client";

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const PREVIEW_SESSION_STORAGE_KEY = "frapp.mobile.preview-session";

export type PreviewAuthMethod = "password" | "magic_link";
type PreviewSessionStatus = "hydrating" | "authenticated" | "unauthenticated";

type PreviewSessionRecord = {
  email: string;
  method: PreviewAuthMethod;
  signedInAt: string;
};

type SignInPayload = {
  email: string;
  method: PreviewAuthMethod;
};

type PreviewSessionContextValue = {
  status: PreviewSessionStatus;
  session: PreviewSessionRecord | null;
  signIn: (payload: SignInPayload) => Promise<void>;
  signOut: () => Promise<void>;
};

const PreviewSessionContext = createContext<PreviewSessionContextValue | null>(
  null,
);

function isPreviewSessionRecord(value: unknown): value is PreviewSessionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.email === "string" &&
    (candidate.method === "password" || candidate.method === "magic_link") &&
    typeof candidate.signedInAt === "string"
  );
}

export function PreviewSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<PreviewSessionStatus>("hydrating");
  const [session, setSession] = useState<PreviewSessionRecord | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function hydrateSession() {
      let hydratedSession: PreviewSessionRecord | null = null;

      try {
        const persistedSession = await AsyncStorage.getItem(
          PREVIEW_SESSION_STORAGE_KEY,
        );

        if (!persistedSession || !isMounted) {
          return;
        }

        const parsedSession = JSON.parse(persistedSession) as unknown;
        if (!isPreviewSessionRecord(parsedSession)) {
          await AsyncStorage.removeItem(PREVIEW_SESSION_STORAGE_KEY);
          return;
        }

        hydratedSession = parsedSession;
        if (isMounted) {
          setSession(parsedSession);
        }
      } catch {
        await AsyncStorage.removeItem(PREVIEW_SESSION_STORAGE_KEY);
      } finally {
        if (isMounted) {
          setStatus(hydratedSession ? "authenticated" : "unauthenticated");
        }
      }
    }

    void hydrateSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const signIn = useCallback(async ({ email, method }: SignInPayload) => {
    const nextSession: PreviewSessionRecord = {
      email,
      method,
      signedInAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(
      PREVIEW_SESSION_STORAGE_KEY,
      JSON.stringify(nextSession),
    );

    setSession(nextSession);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(PREVIEW_SESSION_STORAGE_KEY);
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(
    () => ({
      status,
      session,
      signIn,
      signOut,
    }),
    [session, signIn, signOut, status],
  );

  return (
    <PreviewSessionContext.Provider value={value}>
      {children}
    </PreviewSessionContext.Provider>
  );
}

export function usePreviewSession() {
  const context = useContext(PreviewSessionContext);

  if (!context) {
    throw new Error(
      "usePreviewSession must be used within PreviewSessionProvider.",
    );
  }

  return context;
}
