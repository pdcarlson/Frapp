"use client";

import React, { createContext, useContext } from "react";
import { createFrappClient } from "@repo/api-sdk";

type FrappClient = ReturnType<typeof createFrappClient>;

type FrappClientContextValue = {
  client: FrappClient;
  chapterId: string | null;
  /** The signed-in user, where the app passes it (scopes kept form drafts). */
  userId: string | null;
};

const FrappClientContext = createContext<FrappClientContextValue | null>(null);

export function FrappClientProvider({
  children,
  client,
  chapterId = null,
  userId = null,
}: {
  children: React.ReactNode;
  client: FrappClient;
  chapterId?: string | null;
  userId?: string | null;
}) {
  return (
    <FrappClientContext.Provider value={{ client, chapterId, userId }}>
      {children}
    </FrappClientContext.Provider>
  );
}

export function useFrappClient() {
  const context = useContext(FrappClientContext);
  if (!context) {
    throw new Error("useFrappClient must be used within a FrappClientProvider");
  }
  return context.client;
}

/**
 * The signed-in user and active chapter, or nulls outside a
 * `FrappClientProvider` rather than a throw: for state that only scopes
 * itself by them (kept form drafts) and must not take down a surface
 * rendered without the client.
 */
export function useClientScopeIfAny(): {
  userId: string | null;
  chapterId: string | null;
} {
  const context = useContext(FrappClientContext);
  return {
    userId: context?.userId ?? null,
    chapterId: context?.chapterId ?? null,
  };
}

export function useActiveChapterId() {
  const context = useContext(FrappClientContext);
  if (!context) {
    throw new Error(
      "useActiveChapterId must be used within a FrappClientProvider",
    );
  }
  return context.chapterId;
}
