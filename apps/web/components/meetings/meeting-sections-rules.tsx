"use client";

import { useMeetingTemplate, useSetMeetingTemplate } from "@repo/hooks";
import {
  MEETING_SECTIONS,
  normalizeMeetingSections,
  type MeetingSectionKey,
} from "@repo/validation";
import { ProfileSection } from "@/components/profile/profile-section";
import { RulesList, SwitchRule } from "@/components/settings/module-rules";
import { ErrorState } from "@/components/shared/async-states";
import { SkeletonText } from "@/components/shared/async-states";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/** What each section holds, under its switch. */
const SECTION_HINTS: Readonly<Record<MeetingSectionKey, string>> = {
  attendees:
    "Who checked in to the meeting's event: present, late and excused.",
  summary: "A few paragraphs on what the meeting covered.",
  announcements: "What officers announced.",
  decisions:
    "Motions and what was decided, with the vote count when one was taken.",
  action_items: "What needs doing, who it's on, and when it's due.",
  officer_reports: "Each officer's report.",
  old_business: "Items carried over from earlier meetings.",
  new_business: "Items raised for the first time.",
  discussion_log: "A longer record of who said what.",
};

/**
 * Meetings → Rules: the sections the chapter's minutes show
 * (`spec/behavior/meetings.md` § The template). A switch saves when it
 * flips, like Privacy's. A section switched off keeps what minutes already
 * wrote in it, and those minutes still show it.
 */
export function MeetingSectionsRules({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const templateQuery = useMeetingTemplate();
  const setTemplate = useSetMeetingTemplate();

  if (templateQuery.isPending) return <SkeletonText lines={4} />;
  if (!templateQuery.data) {
    return (
      <ErrorState
        title="Couldn't load the minutes sections"
        onRetry={() => void templateQuery.refetch()}
      />
    );
  }
  const on = new Set(normalizeMeetingSections(templateQuery.data.sections));

  async function toggle(key: MeetingSectionKey, next: boolean) {
    const sections = MEETING_SECTIONS.map((section) => section.key).filter(
      (sectionKey) => (sectionKey === key ? next : on.has(sectionKey)),
    );
    try {
      await setTemplate.mutateAsync(sections);
    } catch (error) {
      toast({
        title: "Couldn't change the sections",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  return (
    <ProfileSection
      id="settings-module-meetings-rules"
      title="Sections in the minutes"
      hint="Every meeting's minutes show these, in this order."
    >
      <RulesList>
        {MEETING_SECTIONS.map((section) => (
          <SwitchRule
            key={section.key}
            label={section.label}
            hint={SECTION_HINTS[section.key]}
            checked={on.has(section.key)}
            disabled={!canManage || setTemplate.isPending}
            onChange={(next) => void toggle(section.key, next)}
          />
        ))}
      </RulesList>
    </ProfileSection>
  );
}
