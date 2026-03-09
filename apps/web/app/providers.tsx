"use client";

import React from "react";
import { QueryProvider } from "@/lib/providers/query-provider";
import { FrappProvider } from "@/lib/providers/frapp-client-provider";
import { NetworkProvider } from "@/lib/providers/network-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <FrappProvider>
          <NetworkProvider>{children}</NetworkProvider>
        </FrappProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
