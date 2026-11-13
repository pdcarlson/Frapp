"use client";

import React, { createContext, useContext } from "react";
import { createFrappClient } from "@repo/api-sdk";

type FrappClient = ReturnType<typeof createFrappClient>;

type FrappClientContextValue = {
  client: FrappClient;
  chapterId: string | null;
};

const FrappClientContext = createContext<FrappClientContextValue | null>(null);

export function FrappClientProvider({
  children,
  client,
  chapterId = null,
}: {
  children: React.ReactNode;
  client: FrappClient;
  chapterId?: string | null;
}) {
  return (
    <FrappClientContext.Provider value={{ client, chapterId }}>
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
 * The active chapter id, or `null` outside a `FrappClientProvider` rather
 * than a throw: for state that only scopes itself by chapter (kept form
 * drafts) and must not take down a surface rendered without the client.
 */
export function useActiveChapterIdIfAny(): string | null {
  return useContext(FrappClientContext)?.chapterId ?? null;
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
