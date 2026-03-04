"use client";

import React, { createContext, useContext } from "react";
import { createFrappClient } from "@repo/api-sdk";

type FrappClient = ReturnType<typeof createFrappClient>;

const FrappClientContext = createContext<FrappClient | null>(null);

export function FrappClientProvider({ 
  children, 
  client 
}: { 
  children: React.ReactNode;
  client: FrappClient;
}) {
  return (
    <FrappClientContext.Provider value={client}>
      {children}
    </FrappClientContext.Provider>
  );
}

export function useFrappClient() {
  const client = useContext(FrappClientContext);
  if (!client) {
    throw new Error("useFrappClient must be used within a FrappClientProvider");
  }
  return client;
}
