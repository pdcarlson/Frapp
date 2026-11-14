"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  aiAvailableFrom,
  isFirstAiReadInFlight,
  useAiConsent,
  useCurrentChapter,
} from "@repo/hooks";
import { AccountSection } from "@/components/personal-settings/account-section";
import { AiSection } from "@/components/personal-settings/ai-section";
import { ChapterAlertsSection } from "@/components/personal-settings/chapter-alerts-section";
import { QuietHoursSection } from "@/components/personal-settings/quiet-hours-section";
import { MyInvoicesSection } from "@/components/personal-settings/my-invoices-section";
import { PersonalSettingsBodySkeleton } from "@/components/personal-settings/personal-settings-skeleton";
import {
  PERSONAL_SETTINGS_SECTIONS,
  isPersonalSettingsSectionShown,
  personalSettingsHref,
  resolvePersonalSettingsSection,
  type PersonalSettingsSection,
} from "@/components/personal-settings/personal-settings-sections";
import { BlockedMembersCard } from "@/components/profile/blocked-members-card";
import { ChatDensityControl } from "@/components/profile/chat-density-control";
import { DiscordHistoryCard } from "@/components/profile/discord-history-card";
import { ProfileSection } from "@/components/profile/profile-section";
import {
  SettingsNavRail,
  type SettingsNavGroup,
} from "@/components/settings/settings-nav-rail";

/**
 * The personal Settings page: the second of the two doors (#3856, epic #4068
 * decision 1). The nav's "Chapter settings" row is the chapter's; this one is
 * the member's own, opened from the account menu on the avatar, the way
 * Discord splits User Settings from Server Settings and Slack splits
 * Preferences from workspace settings. Every section here used to be a block
 * at the bottom of `/profile`, which keeps the profile itself.
 *
 * Only the open section mounts, so only its queries run. There is no
 * page-scale state ladder: no one read feeds the whole page, and each section
 * carries its own offline, loading and error states.
 */
function PersonalSettingsContent() {
  // Whether the server has AI: the AI section shows only on `true` (#4308).
  const aiConsent = useAiConsent();
  const aiAvailable = aiAvailableFrom(aiConsent);
  const section = resolvePersonalSettingsSection(
    useSearchParams().get("section"),
    aiAvailable,
  );
  // The chapter group is named for the chapter it changes with. Before the
  // chapter is known (or with none active) it says so in general terms; each
  // chapter section already tells a member with no chapter to pick one.
  const { data: chapter } = useCurrentChapter();
  const chapterName = chapter?.name.trim();

  const groups: SettingsNavGroup[] = [
    { label: "My account", group: "account" as const },
    {
      label: chapterName ? `In ${chapterName}` : "In your chapter",
      group: "chapter" as const,
    },
  ].map(({ label, group }) => ({
    label,
    items: PERSONAL_SETTINGS_SECTIONS.filter(
      (s) =>
        s.group === group &&
        isPersonalSettingsSectionShown(s.value, aiAvailable),
    ).map(
      (s) => ({
        value: s.value,
        label: s.label,
        href: personalSettingsHref(s.value),
      }),
    ),
  }));

  /*
    The rail waits for the first AI read rather than drawing without the AI
    row and inserting it a moment later, which pushed every row below it
    down (and sent `?section=ai` to Notifications first). A paused read, or
    a first attempt that failed, stops waiting without sitting out the
    retries (#4504): the row stays out, as with AI off.
  */
  if (isFirstAiReadInFlight(aiConsent)) {
    return <PersonalSettingsBodySkeleton />;
  }

  return (
    // `@container`: the rail and the row direction follow this pane's width,
    // since chat can sit beside the page (`settings-nav-rail.tsx`).
    <div className="@container">
      <div className="flex flex-col gap-6 @3xl:flex-row @3xl:items-start">
        <SettingsNavRail label="Settings" groups={groups} current={section} />
        {/* A form's width, as on `/profile`: a 1,100px switch row is not one
            anyone reads across. */}
        <div className="min-w-0 max-w-2xl flex-1 @3xl:py-3">
          <SectionBody section={section} />
        </div>
      </div>
    </div>
  );
}

function SectionBody({ section }: { section: PersonalSettingsSection }) {
  switch (section) {
    case "notifications":
      return <QuietHoursSection />;
    case "appearance":
      /*
        How tightly the thread draws (§11 § Density). Kept on the device, so
        the hint says so: a phone can stay cozy while a laptop goes compact.
        There is no theme choice here: Frapp is dark-only (#3330).
      */
      return (
        <ProfileSection
          id="chat-density"
          title="Chat density"
          hint="Applies on this browser."
        >
          <ChatDensityControl />
        </ProfileSection>
      );
    case "account":
      return <AccountSection />;
    case "ai":
      return <AiSection />;
    case "alerts":
      return <ChapterAlertsSection />;
    case "blocked":
      /*
        The durable undo for a chat block (#2313): its own states, because a
        failed read of the block list must not look like "nobody is blocked".
      */
      return <BlockedMembersCard />;
    case "invoices":
      return <MyInvoicesSection />;
    case "discord":
      return <DiscordHistoryCard />;
  }
}

// `PersonalSettingsContent` reads `?section=` via `useSearchParams`, which Next
// requires to sit under a Suspense boundary (as `settings-page.tsx` does).
export function PersonalSettingsPage() {
  return (
    <Suspense fallback={<PersonalSettingsBodySkeleton />}>
      <PersonalSettingsContent />
    </Suspense>
  );
}
