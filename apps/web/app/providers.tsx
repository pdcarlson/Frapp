"use client";

import React from "react";
import { QueryProvider } from "@/lib/providers/query-provider";
import { FrappProvider } from "@/lib/providers/frapp-client-provider";
import { NetworkProvider } from "@/lib/providers/network-provider";
import { AnalyticsProvider } from "@/lib/providers/analytics-provider";
import { SentryIdentityProvider } from "@/lib/providers/sentry-identity-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <FrappProvider>
          {/* Inside FrappProvider because it needs the authenticated client;
              it renders no UI, so its position is otherwise immaterial. */}
          <SentryIdentityProvider>
            <AnalyticsProvider>
              <NetworkProvider>{children}</NetworkProvider>
            </AnalyticsProvider>
          </SentryIdentityProvider>
        </FrappProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
