"use client";

import React from "react";
import { QueryProvider } from "@/lib/providers/query-provider";
import { FrappProvider } from "@/lib/providers/frapp-client-provider";
import { NetworkProvider } from "@/lib/providers/network-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <FrappProvider>
          <NetworkProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </NetworkProvider>
        </FrappProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
