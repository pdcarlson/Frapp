"use client";

import { NAME_LOCK_COPY } from "@repo/validation";
import { ProfileSection } from "@/components/profile/profile-section";
import { SettingsGroup, SettingsRow } from "@/components/shared/settings-row";

/**
 * Settings → Chapter → Member names (#5801, Paul 2026-11-21). Off, the
 * default, a member settled in this chapter can't rename themselves; officers
 * who manage roles still fix a name from the member's profile. Saves the
 * moment it flips, as every switch on a settings page does. The phone's
 * Chapter settings carries the same row, in the same words.
 */
export function SettingsMemberNames({
  enabled,
  canManage,
  isSaving,
  onChange,
}: {
  enabled: boolean;
  canManage: boolean;
  isSaving: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <ProfileSection id="settings-member-names" title="Member names">
      <SettingsGroup>
        <SettingsRow
          label={NAME_LOCK_COPY.settingLabel}
          description={
            canManage
              ? NAME_LOCK_COPY.settingLine
              : "Your role can't change this."
          }
          checked={enabled}
          disabled={!canManage || isSaving}
          onCheckedChange={onChange}
        />
      </SettingsGroup>
    </ProfileSection>
  );
}
