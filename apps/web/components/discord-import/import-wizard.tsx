"use client";

import { useCallback, useMemo, useState } from "react";
import {
  useConfirmDiscordUploads,
  useCreateDiscordImport,
  useRequestDiscordUploadUrls,
  useSetDiscordChannelMapping,
  useSetDiscordRoleMapping,
  useStartDiscordImport,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { StepDots } from "@/components/onboarding/step-dots";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { ConsentStep } from "./consent-step";
import { UploadStep, type StagedExport } from "./upload-step";
import { ChannelMappingStep, type ChannelChoice } from "./channel-mapping-step";
import { RoleMappingStep } from "./role-mapping-step";
import { ReviewStep } from "./review-step";

/**
 * The Discord import wizard.
 *
 * Follows `components/onboarding/chapter-wizard.tsx` exactly — a `WizardStep`
 * union, a `STEP_ORDER` array, per-step `useState` at the root rather than a
 * reducer, `stepIndex` by lookup, `goBack()` by index arithmetic, and forward
 * motion through explicit per-step footer buttons. Reusing the shape rather
 * than inventing a second one is the point: this is the second multi-step flow
 * in the product and they should read as the same thing.
 */
export type WizardStep = "consent" | "upload" | "channels" | "roles" | "review";

const STEP_ORDER: WizardStep[] = [
  "consent",
  "upload",
  "channels",
  "roles",
  "review",
];

const STEP_LABELS: Record<WizardStep, string> = {
  consent: "Tell your chapter",
  upload: "Upload the export",
  channels: "Map the channels",
  roles: "Map the roles",
  review: "Review and import",
};

export function ImportWizard({
  onStarted,
  onCancel,
}: {
  onStarted: (importId: string) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();

  const [step, setStep] = useState<WizardStep>("consent");
  const [acknowledged, setAcknowledged] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedExport | null>(null);
  const [channelChoices, setChannelChoices] = useState<
    Record<string, ChannelChoice>
  >({});
  const [roleChoices, setRoleChoices] = useState<Record<string, string>>({});

  const createImport = useCreateDiscordImport();
  const requestUrls = useRequestDiscordUploadUrls();
  const confirmUploads = useConfirmDiscordUploads();
  const setChannelMapping = useSetDiscordChannelMapping();
  const setRoleMapping = useSetDiscordRoleMapping();
  const startImport = useStartDiscordImport();

  const stepIndex = STEP_ORDER.indexOf(step);

  function goBack() {
    const previous = STEP_ORDER[stepIndex - 1];
    if (previous) setStep(previous);
  }

  /**
   * Creating the import is what stamps the acknowledgement, so it happens on
   * leaving the consent step rather than at the end — there is no window in
   * which an import exists without it.
   */
  const beginImport = useCallback(async () => {
    if (!acknowledged) return;
    try {
      const created = await createImport.mutateAsync({
        consent_acknowledged: true,
      });
      const createdId = (created as { id?: string } | undefined)?.id;
      if (!createdId) throw new Error("The API did not return an import id.");
      setImportId(createdId);
      setStep("upload");
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not start the import."),
      });
    }
  }, [acknowledged, createImport, toast]);

  const channelsReady = useMemo(() => {
    if (!staged) return false;
    // Every discovered channel needs an explicit answer. The step cannot be
    // advanced by doing nothing, which is what "ask, never guess" means here:
    // `chat_channels` has no unique (chapter_id, name), so a same-name match is
    // never treated as consent to merge.
    return staged.channels.every((channel) => {
      const choice = channelChoices[channel.channelId];
      if (!choice) return false;
      if (choice.action === "use_existing") return !!choice.targetChannelId;
      if (choice.action === "create_new") return !!choice.newName?.trim();
      return true;
    });
  }, [staged, channelChoices]);

  async function submitMappings() {
    if (!importId || !staged) return;
    try {
      await setChannelMapping.mutateAsync({
        id: importId,
        channels: staged.channels.map((channel) => {
          const choice = channelChoices[channel.channelId] ?? {
            action: "skip" as const,
          };
          return {
            discord_channel_id: channel.channelId,
            discord_channel_name: channel.channelName,
            discord_category: channel.category ?? undefined,
            mapping_action: choice.action,
            target_channel_id: choice.targetChannelId ?? undefined,
            new_channel_name: choice.newName?.trim() || undefined,
            new_channel_is_read_only: choice.readOnly ?? true,
            message_count: 0,
          };
        }),
      });
      setStep("roles");
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(
          error,
          "Could not save the channel mapping.",
        ),
      });
    }
  }

  async function submitRolesAndStart() {
    if (!importId || !staged) return;
    try {
      await setRoleMapping.mutateAsync({
        id: importId,
        roles: staged.roles.map((role) => ({
          discord_role_id: role.roleId,
          discord_role_name: role.roleName,
          signet_role_key: roleChoices[role.roleId] ?? "MEMBER",
        })),
      });
      await startImport.mutateAsync({ id: importId });
      onStarted(importId);
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not start the import."),
      });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <header>
        <h2 className="text-lg font-semibold">{STEP_LABELS[step]}</h2>
        <StepDots
          current={stepIndex}
          total={STEP_ORDER.length}
          className="mt-4"
        />
      </header>

      <main className="mt-6 flex-1">
        {step === "consent" ? (
          <ConsentStep acknowledged={acknowledged} onChange={setAcknowledged} />
        ) : null}

        {step === "upload" && importId ? (
          <UploadStep
            importId={importId}
            requestUrls={requestUrls}
            confirmUploads={confirmUploads}
            onStaged={setStaged}
          />
        ) : null}

        {step === "channels" && staged ? (
          <ChannelMappingStep
            channels={staged.channels}
            choices={channelChoices}
            onChange={setChannelChoices}
          />
        ) : null}

        {step === "roles" && staged ? (
          <RoleMappingStep
            roles={staged.roles}
            choices={roleChoices}
            onChange={setRoleChoices}
          />
        ) : null}

        {step === "review" && staged ? (
          <ReviewStep
            staged={staged}
            channelChoices={channelChoices}
            roleChoices={roleChoices}
          />
        ) : null}
      </main>

      <footer className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
        {step === "consent" ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button variant="ghost" onClick={goBack}>
            Back
          </Button>
        )}

        {step === "consent" ? (
          <Button
            onClick={() => void beginImport()}
            disabled={!acknowledged || createImport.isPending}
          >
            Continue
          </Button>
        ) : null}

        {step === "upload" ? (
          <Button
            onClick={() => setStep("channels")}
            disabled={!staged || staged.pendingUploads > 0}
          >
            Continue
          </Button>
        ) : null}

        {step === "channels" ? (
          <Button
            onClick={() => void submitMappings()}
            disabled={!channelsReady || setChannelMapping.isPending}
          >
            Continue
          </Button>
        ) : null}

        {step === "roles" ? (
          <Button onClick={() => setStep("review")}>Continue</Button>
        ) : null}

        {step === "review" ? (
          <Button
            onClick={() => void submitRolesAndStart()}
            disabled={setRoleMapping.isPending || startImport.isPending}
          >
            Start import
          </Button>
        ) : null}
      </footer>
    </div>
  );
}
