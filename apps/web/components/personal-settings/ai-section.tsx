"use client";

import { useId } from "react";
import { errorCopy, useAiConsent, useAnswerAiConsent } from "@repo/hooks";
import { AI_CONSENT_COPY, formatAiAnswerDate } from "@repo/validation";
import { ProfileSection } from "@/components/profile/profile-section";
import { AiConsentDetails } from "@/components/ai/ai-consent-sheet";
import { anyReadUncached } from "@/components/shared/async-states";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { Switch } from "@/components/ui/switch";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Settings → AI: the member's answer on the AI sheet, changed any time
 * (`spec/behavior/ai.md` § Consent: "A member can change the answer later in
 * Settings"). It sits in "My account" because the answer is the person's,
 * not a chapter's: one Yes or No covers every chapter they are in.
 *
 * The whole sheet is on the page under the switch, so turning it on here is
 * as informed as answering the sheet: the switch says Yes or No to exactly
 * the rows shown. Turning it off is a No, which the server answers by
 * dropping what was made from the member's words (`onConsentWithdrawn`).
 *
 * The rail shows the row only while the server has AI (`useAiConsent`
 * answers `null` otherwise).
 */
export function AiSection() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const consentQuery = useAiConsent();
  const answer = useAnswerAiConsent();
  const switchId = useId();
  const statusId = `${switchId}-status`;
  const consent = consentQuery.data;

  if (isOffline && anyReadUncached(consentQuery)) {
    return (
      <NestedOffline
        sole
        title="AI settings unavailable offline"
        description="Reconnect to see your answer."
        onRetry={() => void consentQuery.refetch()}
      />
    );
  }
  if (consentQuery.isError && anyReadUncached(consentQuery)) {
    return (
      <NestedError
        sole
        title="Couldn't load your AI settings"
        description="Retry in a moment."
        onRetry={() => void consentQuery.refetch()}
      />
    );
  }
  // `null` is a server with no AI; the rail has no row for it, so a
  // hand-typed `?section=ai` lands on nothing rather than a dead switch.
  if (!consent) return null;

  async function change(next: boolean) {
    if (!consent) return;
    try {
      await answer.mutateAsync({
        sheet_version: consent.sheet.version,
        answer: next ? "yes" : "no",
      });
      toast({
        title: next ? AI_CONSENT_COPY.turnedOn : AI_CONSENT_COPY.turnedOff,
      });
    } catch (error) {
      toast({
        title: AI_CONSENT_COPY.saveFailed,
        description: errorCopy(error),
        variant: "destructive",
      });
    }
  }

  let status: string;
  if (consent.answer !== null && consent.answered_at) {
    const date = formatAiAnswerDate(consent.answered_at);
    status =
      consent.answer === "yes"
        ? AI_CONSENT_COPY.answeredYes(date)
        : AI_CONSENT_COPY.answeredNo(date);
  } else if (consent.sheet_changed) {
    status = AI_CONSENT_COPY.changedSince;
  } else {
    status = AI_CONSENT_COPY.unanswered;
  }

  return (
    <ProfileSection id="ai" title={AI_CONSENT_COPY.settingsTitle}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-8 rounded-[14px] border border-border px-4 py-4">
          <div className="min-w-0 space-y-0.5">
            <label
              htmlFor={switchId}
              className="text-sm font-medium text-foreground"
            >
              {AI_CONSENT_COPY.settingsSwitch}
            </label>
            <p id={statusId} className="text-caption text-muted-foreground">
              {status}
            </p>
          </div>
          <Switch
            id={switchId}
            checked={consent.answer === "yes"}
            disabled={isOffline || answer.isPending}
            onCheckedChange={(next) => void change(next)}
            aria-describedby={statusId}
          />
        </div>
        <AiConsentDetails sheet={consent.sheet} />
      </div>
    </ProfileSection>
  );
}
