"use client";

import { useEffect, useRef } from "react";
import { READ_RECEIPTS_COPY, useReadReceiptsSetting } from "@repo/hooks";
import { ProfileSection } from "@/components/profile/profile-section";
import { SettingsGroup, SettingsRow } from "@/components/shared/settings-row";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * The Read receipts switch (#5519, Paul, 2026-11-18), under Appearance and
 * chat, as the phone keeps it under Settings › Chat. Two-way, as WhatsApp's
 * is; the copy and the write are `useReadReceiptsSetting`'s, shared with the
 * phone. Drawn once the settings read has answered, so a member who turned it
 * off never sees it on first.
 */
export function ReadReceiptsSection() {
  const setting = useReadReceiptsSetting();
  const { isOffline } = useNetwork();
  const { toast } = useToast();

  // A failed save is said once, as the AI switch says its own.
  const failed = setting.failed;
  const told = useRef(false);
  useEffect(() => {
    if (failed && !told.current) {
      toast({ title: READ_RECEIPTS_COPY.saveFailed, variant: "destructive" });
    }
    told.current = failed;
  }, [failed, toast]);

  if (!setting.ready) return null;

  return (
    <ProfileSection id="read-receipts" title={READ_RECEIPTS_COPY.label}>
      <SettingsGroup>
        {" "}
        <SettingsRow
          label={READ_RECEIPTS_COPY.label}
          description={READ_RECEIPTS_COPY.description}
          checked={setting.enabled}
          disabled={isOffline || setting.pending}
          onCheckedChange={setting.setEnabled}
        />{" "}
      </SettingsGroup>
    </ProfileSection>
  );
}
