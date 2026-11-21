"use client";

import {
  CHAT_REPORTS_NOTIFICATION_SCREEN,
  DISCORD_IMPORT_NOTIFICATION_SCREEN,
} from "@repo/hooks";
import { StudyZonesManager } from "@/components/geofences/study-zones-manager";
import { ChatAdminPage } from "@/components/chat-admin/chat-admin-page";
import { DiscordImportPage } from "@/components/discord-import/discord-import-page";
import { ReportsPage } from "@/components/reports/reports-page";
import { SettingsSubpage as SubpageFrame } from "@/components/settings/settings-subpage";
import {
  CHAT_SETTINGS_PATH,
  type SettingsSubpage,
} from "@/components/settings/settings-paths";
import { MarkScreensSeen } from "@/lib/notifications/mark-screens-seen";

/**
 * The officer tools as Chapter settings draws them (#3837), kept out of
 * `settings-page.tsx` so its tests can stand them in without mocking every
 * read each tool makes.
 */

/**
 * The tool a module page draws as its own body: Study zones' zone list,
 * Chat's channels and report queue, the Reports form. Only for a viewer who
 * holds it (`holdsTool` takes a `SETTINGS_TOOLS` id); the tool's row is not
 * on the page's Tools list either way (`embedded`).
 */
export function SettingsToolBody({
  moduleKey,
  holdsTool,
}: {
  moduleKey: string;
  holdsTool: (toolId: string) => boolean;
}) {
  if (moduleKey === "geofences" && holdsTool("study-zones")) {
    return <StudyZonesManager />;
  }
  if (moduleKey === "chat" && holdsTool("chat-admin")) {
    return (
      <>
        {/* Opening the report queue reads the new-report notices. */}
        <MarkScreensSeen screens={[CHAT_REPORTS_NOTIFICATION_SCREEN]} />
        <ChatAdminPage />
      </>
    );
  }
  if (moduleKey === "reports" && holdsTool("reports")) return <ReportsPage />;
  return null;
}

/** A page drawn in place of a module page (`settingsSubpageFor`). */
export function SettingsToolSubpage({ subpage }: { subpage: SettingsSubpage }) {
  if (subpage.kind === "channel") {
    return (
      <>
        <MarkScreensSeen screens={[CHAT_REPORTS_NOTIFICATION_SCREEN]} />
        {/*
          Keyed by channel, so opening another channel's settings starts from
          that channel's row rather than the last one's drafts.
        */}
        <ChatAdminPage
          key={subpage.channelId}
          initialChannelId={subpage.channelId}
        />
      </>
    );
  }
  return (
    <SubpageFrame
      backHref={CHAT_SETTINGS_PATH}
      backLabel="Chat"
      title="Discord import"
    >
      {/* Opening the import reads its finished-or-failed notice. */}
      <MarkScreensSeen screens={[DISCORD_IMPORT_NOTIFICATION_SCREEN]} />
      <DiscordImportPage />
    </SubpageFrame>
  );
}
