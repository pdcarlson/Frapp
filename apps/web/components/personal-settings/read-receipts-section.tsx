"use client";

import { useEffect, useId, useRef } from "react";
import { READ_RECEIPTS_COPY, useReadReceiptsSetting } from "@repo/hooks";
import { ProfileSection } from "@/components/profile/profile-section";
import { Switch } from "@/components/ui/switch";
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
  const switchId = useId();
  const captionId = useId();

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
      <div className="flex items-start justify-between gap-8 rounded-[14px] border border-border px-4 py-4">
        <div className="min-w-0 space-y-0.5">
          <label
            htmlFor={switchId}
            className="text-sm font-medium text-foreground"
          >
            {READ_RECEIPTS_COPY.label}
          </label>
          <p id={captionId} className="text-caption text-muted-foreground">
            {READ_RECEIPTS_COPY.description}
          </p>
        </div>
        <Switch
          id={switchId}
          checked={setting.enabled}
          disabled={isOffline || setting.pending}
          onCheckedChange={setting.setEnabled}
          aria-describedby={captionId}
        />
      </div>
    </ProfileSection>
  );
}
