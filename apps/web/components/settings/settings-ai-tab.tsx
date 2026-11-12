"use client";

import { useId } from "react";
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
  type AiChapterSwitchKey,
  type AiSwitchCopy,
} from "@repo/validation";
import { Switch } from "@/components/ui/switch";
import { RulesList } from "@/components/settings/module-rules";
import { anyReadUncached } from "@/components/shared/async-states";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";

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
 * on something that does nothing yet.
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
        title="AI settings unavailable offline"
        description="Reconnect to see which AI features are on."
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  } else if (settingsQuery.isError && anyReadUncached(settingsQuery)) {
    body = (
      <NestedError
        title={AI_SETTINGS_COPY.loadFailed}
        description="Retry in a moment."
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  } else {
    body = (
      <AiSwitchList
        settings={settings ?? null}
        pendingKey={
          update.isPending
            ? (Object.keys(update.variables ?? {})[0] as
                | AiChapterSwitchKey
                | undefined)
            : undefined
        }
        disabled={isOffline}
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
  pendingKey,
  disabled,
  onToggle,
}: {
  settings: AiChapterSettings | null;
  pendingKey?: AiChapterSwitchKey;
  disabled?: boolean;
  onToggle: (entry: AiSwitchCopy, next: boolean) => void;
}) {
  const canChange = settings?.can_change === true;
  return (
    <RulesList>
      {AI_SWITCHES.map((entry) => {
        const parentOff =
          entry.dependsOn !== undefined && settings?.[entry.dependsOn] !== true;
        return (
          <AiSwitchRow
            key={entry.key}
            entry={entry}
            checked={settings?.[entry.key] === true}
            nested={entry.dependsOn !== undefined}
            parentOff={parentOff}
            disabled={
              !canChange ||
              disabled === true ||
              parentOff ||
              pendingKey === entry.key
            }
            onChange={(next) => onToggle(entry, next)}
          />
        );
      })}
    </RulesList>
  );
}

function AiSwitchRow({
  entry,
  checked,
  nested,
  parentOff,
  disabled,
  onChange,
}: {
  entry: AiSwitchCopy;
  checked: boolean;
  nested: boolean;
  parentOff: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-8 px-4 py-4",
        // Indented under the switch it belongs to.
        nested && "pl-10",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <label
          htmlFor={id}
          className={cn(
            "text-sm font-medium",
            parentOff ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {entry.label}
        </label>
        <div id={hintId} className="space-y-1 text-caption text-muted-foreground">
          <p>{entry.description}</p>
          {entry.notYetInApp ? <p>{entry.notYetInApp}</p> : null}
          {parentOff ? <p>{AI_SETTINGS_COPY.dependsOnAsk}</p> : null}
        </div>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-describedby={hintId}
      />
    </div>
  );
}
