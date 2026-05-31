"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

type Props = {
  /** Current persisted value of `chapters.analytics_opt_out`. */
  analyticsOptOut: boolean;
  /** Whether the caller holds `chapter-config:manage`. */
  canManage: boolean;
  /** Persist the opt-out through `usePatchOrgConfig`. */
  onToggle: (optOut: boolean) => void;
  isSaving?: boolean;
};

/**
 * Settings → Privacy. Chapter-wide controls for how member data is used.
 *
 * Today this is the analytics opt-out. The switch is framed positively
 * ("Chapter analytics" on/off) to avoid a double-negative, while the persisted
 * column stays `analytics_opt_out` — so checked = analytics enabled =
 * `!analytics_opt_out`. When opted out, the web client emits zero events for
 * this chapter's members and the API repeats the check as defense-in-depth
 * (`spec/behavior/data-retention.md` #analytics-events-pseudonymous). The write
 * goes through the config PATCH mutation, so it is audit-logged like every
 * other settings change.
 */
export function SettingsPrivacyTab({
  analyticsOptOut,
  canManage,
  onToggle,
  isSaving,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy</CardTitle>
        <CardDescription>
          Control how your chapter&apos;s data is used. Changes here are written
          to the chapter audit log.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 rounded-md border border-border p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Chapter analytics</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Frapp collects <strong>pseudonymous</strong> usage analytics
              (which features get used, not their contents) to fix bugs and
              improve the product. Member identities are hashed and message
              content is never sent. Turn this off to stop all analytics for
              your chapter&apos;s members.
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <Switch
              checked={!analyticsOptOut}
              disabled={!canManage || isSaving}
              onCheckedChange={(enabled) => onToggle(!enabled)}
              aria-label="Chapter analytics enabled"
            />
          </div>
        </div>
        {!canManage ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Only users with <code>chapter-config:manage</code> can change this.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
