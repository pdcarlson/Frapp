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

export function useActiveChapterId() {
  const context = useContext(FrappClientContext);
  if (!context) {
    throw new Error(
      "useActiveChapterId must be used within a FrappClientProvider",
    );
  }
  return context.chapterId;
}
