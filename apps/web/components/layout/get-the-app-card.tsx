"use client";

import { X } from "lucide-react";
import { STORE_LISTING_URLS, openAppUrl } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { dismissGetTheApp, useGetTheAppDismissed } from "@/lib/get-the-app";
import { usePhonePlatform } from "@/lib/use-phone-platform";
import { cn } from "@/lib/utils";

export const GET_THE_APP_TITLE = "Frapp works best in the app";

/**
 * The phone dashboard's Get the app card (#4002): a strip under the top bar,
 * on every dashboard page, only on a phone, until this browser dismisses it
 * (`lib/get-the-app.ts`).
 *
 * The way Slack's and Discord's mobile web point at their apps, without their
 * full-screen interstitials: the dashboard still works on a phone, so the
 * card suggests and steps aside. Get the app is the primary because most
 * people reading this don't have the app yet; Open the app is for those who
 * do (on Android its intent link opens Play when the app is missing).
 *
 * Drawn in the ops nudge's recipe (`components/chat/ops-setup-nudge.tsx`):
 * the Accent tokens, a bottom border only, `role="region"` rather than a live
 * region, since it is a standing suggestion, not news.
 */
export function GetTheAppCard() {
  const phone = usePhonePlatform();
  const dismissed = useGetTheAppDismissed();
  if (phone === null || dismissed) return null;

  return (
    <div
      role="region"
      aria-labelledby="get-the-app-title"
      className="flex items-start gap-3 border-b border-accent-border bg-accent-subtle px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p
          id="get-the-app-title"
          className="text-sm font-bold text-accent-text"
        >
          {GET_THE_APP_TITLE}
        </p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          Chat, events and check-in on your phone, with notifications.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button asChild variant="tinted" size="sm">
            <a href={STORE_LISTING_URLS[phone]}>Get the app</a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={openAppUrl(phone)}>Open the app</a>
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismissGetTheApp}
        aria-label="Dismiss the Get the app suggestion"
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md pointer-coarse:h-11 pointer-coarse:w-11",
          "text-accent-text transition-colors hover:bg-accent-subtle-hover",
          FOCUS_RING,
        )}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
