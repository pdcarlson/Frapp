"use client";

import {
  type AiChapterSettings,
  errorCopy,
  useAiChapterSettings,
  useAiConsent,
  useUpdateAiChapterSettings,
} from "@repo/hooks";
import {
  AI_SETTINGS_COPY,
  AI_SWITCHES,
  formatAiAnswerDate,
  joinNames,
  type AiSwitchCopy,
} from "@repo/validation";
import { RulesList, SwitchRule } from "@/components/settings/module-rules";
import { anyReadUncached } from "@/components/shared/async-states";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Chapter settings → AI (#4308, `spec/behavior/ai.md` § Consent, gate 1):
 * the president's switch for each AI feature family, laid out like a module
 * page (#4073): the title, what the switches share and with whom, then the
 * switches.
 *
 * The rail shows this row only while the server has AI
 * (`useAiConsent` answers `null` otherwise), so with `AI_ENABLED` off Chapter
 * settings is exactly what it was.
 *
 * Every officer who opens Chapter settings sees the switches, so a vice
 * president can tell a member why a feature is missing; only the president
 * changes them (`can_change`; the PATCH checks again and audits each change
 * to `#chapter-audit`). Slack's and Notion's workspace AI settings follow
 * the same split: one owner switch per feature, visible to admins.
 *
 * "Include channel messages" only changes what Ask reads, so it sits nested
 * under Ask Frapp and waits for it, the way iOS draws a dependent switch.
 * The server stores it either way; the page just won't let a president turn
 * on something that does nothing yet, and still lets them turn it off.
 */
export function SettingsAiTab() {
  const { isOffline } = useNetwork();
  const settingsQuery = useAiChapterSettings();
  const consentQuery = useAiConsent();
  const update = useUpdateAiChapterSettings();
  const { toast } = useToast();

  const settings = settingsQuery.data;
  const providers = joinNames(
    consentQuery.data?.sheet.providers.map((provider) => provider.name) ?? [],
  );

  async function toggle(entry: AiSwitchCopy, next: boolean) {
    try {
      await update.mutateAsync({ [entry.key]: next });
      toast({
        title: next
          ? AI_SETTINGS_COPY.turnedOn(entry.label)
          : AI_SETTINGS_COPY.turnedOff(entry.label),
      });
    } catch (error) {
      toast({
        title: AI_SETTINGS_COPY.saveFailed,
        description: errorCopy(error),
        variant: "destructive",
      });
    }
  }

  let body: React.ReactNode;
  if (isOffline && anyReadUncached(settingsQuery)) {
    body = (
      <NestedOffline
        title={AI_SETTINGS_COPY.offlineTitle}
        description={AI_SETTINGS_COPY.offlineDescription}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  } else if (settingsQuery.isError && anyReadUncached(settingsQuery)) {
    body = (
      <NestedError
        title={AI_SETTINGS_COPY.loadFailed}
        description={AI_SETTINGS_COPY.retryLater}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  } else {
    body = (
      <AiSwitchList
        settings={settings ?? null}
        // Every switch waits while one saves: each answer replaces the whole
        // cached row, so two saves in flight could leave one drawn wrong.
        disabled={isOffline || update.isPending}
        onToggle={(entry, next) => void toggle(entry, next)}
      />
    );
  }

  return (
    <div className="space-y-10">
      <header className="space-y-1 border-b border-border pb-6">
        <h2 className="text-title text-foreground">{AI_SETTINGS_COPY.title}</h2>
        {/*
          Held at its height until the providers arrive (they come from the
          sheet read), so the line never lands and pushes the switches down.
        */}
        <p className="min-h-10 text-sm text-muted-foreground">
          {providers ? AI_SETTINGS_COPY.description(providers) : null}
        </p>
      </header>
      <div className="space-y-3">
        {body}
        {settings ? (
          <p className="text-caption text-muted-foreground">
            {settings.can_change ? null : `${AI_SETTINGS_COPY.presidentOnly} `}
            {settings.updated_at
              ? AI_SETTINGS_COPY.lastChanged(
                  formatAiAnswerDate(settings.updated_at),
                )
              : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The three switches. Before the read lands they draw off and disabled at
 * their full height, so nothing moves when it does; a read can't be in
 * flight long, since this page only shows once the server answered.
 */
export function AiSwitchList({
  settings,
  disabled,
  onToggle,
}: {
  settings: AiChapterSettings | null;
  disabled?: boolean;
  onToggle: (entry: AiSwitchCopy, next: boolean) => void;
}) {
  const canChange = settings?.can_change === true;
  return (
    <RulesList>
      {AI_SWITCHES.map((entry) => {
        const parentOff =
          entry.dependsOn !== undefined && settings?.[entry.dependsOn] !== true;
        const checked = settings?.[entry.key] === true;
        return (
          <SwitchRule
            key={entry.key}
            label={entry.label}
            hint={
              <div className="space-y-1">
                <p>{entry.description}</p>
                {entry.notYetInApp ? <p>{entry.notYetInApp}</p> : null}
                {parentOff && !checked ? (
                  <p>{AI_SETTINGS_COPY.dependsOnAsk}</p>
                ) : null}
              </div>
            }
            checked={checked}
            nested={entry.dependsOn !== undefined}
            muted={parentOff}
            disabled={
              !canChange ||
              disabled === true ||
              // Waiting on its parent blocks turning it on, never off: a
              // president who turned Ask off can still clear what it reads.
              (parentOff && !checked)
            }
            onChange={(next) => onToggle(entry, next)}
          />
        );
      })}
    </RulesList>
  );
}
