"use client";

import { useState } from "react";
import { errorCopy, useAiConsent, useFrappAiChoice } from "@repo/hooks";
import { AI_SETTINGS_COPY, FRAPP_AI_COPY } from "@repo/validation";
import { ProfileSection } from "@/components/profile/profile-section";
import { MeetFrappAiDialog } from "@/components/ai/meet-frapp-ai";
import { anyReadUncached } from "@/components/shared/async-states";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { SettingsGroup, SettingsRow } from "@/components/shared/settings-row";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Settings → Frapp AI: the member's own switch, changed any time
 * (`spec/behavior/ai.md` § Consent). It sits in "My account" because the
 * answer is the person's, not a chapter's: one answer covers every chapter
 * they are in.
 *
 * Turning it on opens Meet Frapp AI, so the yes is given where the companies
 * are named and the privacy policy is linked, as everywhere else. Turning it
 * off is immediate, and the server drops what was made from the member's
 * words (`onConsentWithdrawn`).
 *
 * The rail shows the row only while the server has AI (`useAiConsent`
 * answers `null` otherwise).
 */
export function AiSection() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const consentQuery = useAiConsent();
  const choice = useFrappAiChoice();
  const [meetOpen, setMeetOpen] = useState(false);
  const consent = consentQuery.data;

  if (isOffline && anyReadUncached(consentQuery)) {
    return (
      <NestedOffline
        sole
        title={FRAPP_AI_COPY.offlineTitle}
        description={FRAPP_AI_COPY.offlineDescription}
        onRetry={() => void consentQuery.refetch()}
      />
    );
  }
  if (consentQuery.isError && anyReadUncached(consentQuery)) {
    return (
      <NestedError
        sole
        title={FRAPP_AI_COPY.loadFailed}
        description={AI_SETTINGS_COPY.retryLater}
        onRetry={() => void consentQuery.refetch()}
      />
    );
  }
  // `null` is a server with no AI; the rail has no row for it, so a
  // hand-typed `?section=ai` lands on nothing rather than a dead switch.
  if (!consent) return null;

  async function turnOff() {
    try {
      await choice.notNow();
      toast({ title: FRAPP_AI_COPY.turnedOff });
    } catch (error) {
      toast({
        title: FRAPP_AI_COPY.turnOffFailed,
        description: errorCopy(error),
        variant: "destructive",
      });
    }
  }

  return (
    <ProfileSection id="ai" title={FRAPP_AI_COPY.settingsTitle}>
      <SettingsGroup>
        <SettingsRow
          label={FRAPP_AI_COPY.settingsSwitch}
          description={FRAPP_AI_COPY.settingsCaption}
          checked={consent.answer === "yes"}
          disabled={isOffline || choice.pending}
          onCheckedChange={(next) => {
            if (next) setMeetOpen(true);
            else void turnOff();
          }}
        />
      </SettingsGroup>
      <MeetFrappAiDialog
        open={meetOpen}
        onAnswered={(on) => {
          setMeetOpen(false);
          if (on) toast({ title: FRAPP_AI_COPY.turnedOn });
        }}
        onDismiss={() => setMeetOpen(false)}
      />
    </ProfileSection>
  );
}
