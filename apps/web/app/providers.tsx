"use client";

import React from "react";
import { QueryProvider } from "@/lib/providers/query-provider";
import { FrappProvider } from "@/lib/providers/frapp-client-provider";
import { NetworkProvider } from "@/lib/providers/network-provider";
import { AnalyticsProvider } from "@/lib/providers/analytics-provider";
import { ObservabilityIdentityProvider } from "@/lib/providers/observability-identity-provider";

/*
 * No theme provider: Signet is dark-only (`spec/ui/brand-identity.md` §1), so
 * the `next-themes` light/dark/system machinery left with the #920 reskin.
 * The single `:root` block in `packages/theme/src/signet.css` is the theme.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <FrappProvider>
        {/* Inside FrappProvider because it needs the authenticated client;
            it renders no UI, so its position is otherwise immaterial. */}
        <ObservabilityIdentityProvider>
          <AnalyticsProvider>
            <NetworkProvider>{children}</NetworkProvider>
          </AnalyticsProvider>
        </ObservabilityIdentityProvider>
      </FrappProvider>
    </QueryProvider>
  );
}
