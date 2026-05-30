import React, { createContext, useCallback, useContext, useMemo } from "react";
import { useFrappClient } from "@repo/hooks";
import type { AnalyticsProperties } from "@repo/validation";

/**
 * Pseudonymous analytics for the mobile app (issue #464) — the Expo mirror of
 * the web provider.
 *
 * The client never holds the per-environment salt. It posts behavioral events
 * to the API (`POST /v1/analytics/events`), which derives the pseudonymous key
 * `hmac_sha256(salt, user_id)` server-side and enforces the per-chapter
 * opt-out. The raw user id never reaches the analytics provider, and the salt
 * never ships in the app bundle. See `spec/behavior/data-retention.md`
 * (#analytics-events-pseudonymous).
 *
 * `track` is fire-and-forget so a failed event never disrupts the UI.
 *
 * NOTE: the mobile client has no active-chapter context yet (it is still the
 * preview shell — real member flows land in #253, and `frapp-client.tsx`
 * hardcodes `getChapterId: () => null`). Until then mobile events carry no
 * `chapter_id`, so the server's per-chapter opt-out gate cannot apply to them.
 * Wiring the active chapter into analytics events is tracked alongside mobile
 * parity (#253) and the opt-out toggle (#466); the web provider already passes
 * it. This is the documented limitation, not a silent bypass.
 */
type TrackFn = (name: string, properties?: AnalyticsProperties) => void;

const AnalyticsContext = createContext<TrackFn | null>(null);

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const client = useFrappClient();

  const track = useCallback<TrackFn>(
    (name, properties) => {
      void client
        .POST("/v1/analytics/events", {
          body: {
            name,
            ...(properties ? { properties } : {}),
          },
        })
        .catch(() => {
          // Best-effort: analytics must never surface an error to the user.
        });
    },
    [client],
  );

  const value = useMemo(() => track, [track]);

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  );
}

/**
 * Returns a `track(name, properties)` function. Event names must be behavioral
 * (kebab-case, e.g. "opened-channel"); content/PII properties are rejected by
 * the server. Safe to call outside the provider (no-op).
 */
export function useAnalytics(): TrackFn {
  const track = useContext(AnalyticsContext);
  return track ?? (() => {});
}
