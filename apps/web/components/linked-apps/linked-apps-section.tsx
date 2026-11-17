"use client";

import type { ReactNode } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { ProfileSection } from "@/components/profile/profile-section";
import { denseListClassName } from "@/components/shared/table-controls";
import { DiscordRow } from "@/components/linked-apps/discord-row";
import { GoogleCalendarRow } from "@/components/linked-apps/google-calendar-row";
import { SignInMethodRows } from "@/components/linked-apps/sign-in-methods";
import { useGoogleCalendarReturn } from "@/lib/events/google-calendar-connect";

/**
 * Settings → Linked apps (`/preferences?section=apps`, #5407): every outside
 * account tied to Frapp, one row each with its state drawn (a green check, a
 * greyed row, or red when it expired).
 *
 * Shaped after the lists members already know: Discord's User Settings →
 * Connections, Slack's and Notion's connected apps, and Google Account's
 * "Ways you sign in". Two groups, by whose link it is: the apps linked in this
 * chapter (Google Calendar writes this chapter's events; the Discord link
 * attributes this chapter's import), and the ways the account signs in, which
 * follow the member everywhere. A future integration is one more row.
 *
 * Google's and Discord's sign-ins both come back here and finish on arrival,
 * so the member sees the row they pressed turn green.
 */
export function LinkedAppsSection() {
  useGoogleCalendarReturn();
  const { data: chapter } = useCurrentChapter();
  const chapterName = chapter?.name.trim();

  return (
    <ProfileSection id="linked-apps" title="Linked apps">
      <div className="space-y-6">
        <LinkedGroup
          label={chapterName ? `In ${chapterName}` : "In your chapter"}
        >
          <GoogleCalendarRow webReturn="linked_apps" />
          <DiscordRow />
        </LinkedGroup>
        <LinkedGroup label="Sign in">
          <SignInMethodRows />
        </LinkedGroup>
      </div>
    </ProfileSection>
  );
}

function LinkedGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    // Hidden while no row in it is drawn (an app the server doesn't offer
    // draws none), so a group never stands as a bare heading.
    <div className="hidden space-y-1 has-[li]:block">
      <h3 className="text-caption font-semibold text-muted-foreground">
        {label}
      </h3>
      <ul className={denseListClassName}>{children}</ul>
    </div>
  );
}
