"use client";

import { useCallback, useMemo, useState } from "react";
import {
  useConfirmDiscordUploads,
  useCreateDiscordImport,
  useDiscordAvailability,
  useDiscordImportFiles,
  useDiscoverDiscordChannels,
  useRequestDiscordUploadUrls,
  useSetDiscordChannelMapping,
  useSetDiscordRoleMapping,
  useSetDiscoveredChannelMapping,
  useStartDiscordImport,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { StepDots } from "@/components/onboarding/step-dots";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { ConsentStep } from "./consent-step";
import { SourceStep, type ImportSource } from "./source-step";
import { ConnectStep } from "./connect-step";
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
 *
 * ## Two ways in, one wizard
 *
 * The `source` choice decides which of two middle steps runs — `connect` (add
 * the Signet bot and let the API read the server) or `upload` (bring a
 * DiscordChatExporter export). Everything on either side of that is shared
 * verbatim: the same consent gate, the same channel mapping, the same role
 * worksheet, the same review.
 *
 * The upload path is **not** a fallback that switches on when the bot is
 * unavailable. It is a supported choice, offered every time, because it is what
 * keeps working if Discord ever throttles one shared bot across every chapter.
 */
export type WizardStep =
  | "source"
  | "connect"
  | "consent"
  | "upload"
  | "channels"
  | "roles"
  | "review";

/**
 * Both orders, spelled out rather than computed.
 *
 * `connect` sits BEFORE `consent` on the bot path and that ordering is
 * load-bearing, not cosmetic: creating a bot import resolves the chapter's
 * guild server-side, so the API refuses one for a chapter that has not
 * connected yet. Leaving `consent` is what mints the import on both paths.
 */
const STEP_ORDERS: Record<ImportSource, WizardStep[]> = {
  bot: ["source", "connect", "consent", "channels", "roles", "review"],
  upload: ["source", "consent", "upload", "channels", "roles", "review"],
};

const STEP_LABELS: Record<WizardStep, string> = {
  source: "Choose how",
  connect: "Connect Discord",
  consent: "Tell your chapter",
  upload: "Upload the export",
  channels: "Map the channels",
  roles: "Map the roles",
  review: "Review and import",
};

export function ImportWizard({
  onStarted,
  onCancel,
  initialSource = null,
  initialStep = "source",
  handshake = null,
}: {
  onStarted: (importId: string) => void;
  onCancel: () => void;
  /** Preselected when the browser returns from Discord's consent screen. */
  initialSource?: ImportSource | null;
  initialStep?: WizardStep;
  /** The callback's one-time confirmation token, when returning from Discord. */
  handshake?: string | null;
}) {
  const { toast } = useToast();

  const [source, setSource] = useState<ImportSource | null>(initialSource);
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [acknowledged, setAcknowledged] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedExport | null>(null);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [channelChoices, setChannelChoices] = useState<
    Record<string, ChannelChoice>
  >({});
  const [roleChoices, setRoleChoices] = useState<Record<string, string>>({});

  const availability = useDiscordAvailability();
  const createImport = useCreateDiscordImport();
  const requestUrls = useRequestDiscordUploadUrls();
  const confirmUploads = useConfirmDiscordUploads();
  const discoverChannels = useDiscoverDiscordChannels();
  const setChannelMapping = useSetDiscordChannelMapping();
  const setDiscoveredMapping = useSetDiscoveredChannelMapping();
  const setRoleMapping = useSetDiscordRoleMapping();
  const startImport = useStartDiscordImport();
  // Drives the resume: anything the manifest already records as landed is not
  // re-sent when the admin re-picks the folder.
  const importFiles = useDiscordImportFiles(importId, {
    enabled: step === "upload",
  });
  const alreadyUploaded = useMemo(
    () =>
      new Set(
        (
          (importFiles.data ?? []) as {
            relative_path: string;
            uploaded_at: string | null;
          }[]
        )
          .filter((file) => file.uploaded_at !== null)
          .map((file) => file.relative_path),
      ),
    [importFiles.data],
  );

  const stepOrder = STEP_ORDERS[source ?? "upload"];
  const stepIndex = stepOrder.indexOf(step);

  function goBack() {
    const previous = stepOrder[stepIndex - 1];
    if (previous) setStep(previous);
  }

  /**
   * Creating the import is what stamps the acknowledgement, so it happens on
   * leaving the consent step rather than at the end — there is no window in
   * which an import exists without it.
   *
   * On the bot path the same call also scans the connected server, because the
   * channel list is something only the API can produce and the admin has
   * nothing to do between the two.
   */
  const beginImport = useCallback(async () => {
    if (!acknowledged || !source) return;
    try {
      // Reuse the import this step already created, if it did.
      //
      // The scan below can fail for ordinary reasons — the bot was removed from
      // the server, Discord is slow — and the admin is left on this step with
      // Continue still enabled. Without this, every retry mints another
      // `discord_imports` row (consent stamped, guild stamped) and orphans the
      // last one in `draft` for them to delete by hand.
      const createdId =
        importId ??
        (
          (await createImport.mutateAsync({
            consent_acknowledged: true,
            source,
          })) as { id?: string } | undefined
        )?.id;
      if (!createdId) throw new Error("The API did not return an import id.");
      setImportId(createdId);

      if (source === "upload") {
        setStep("upload");
        return;
      }

      const discovery = await discoverChannels.mutateAsync({ id: createdId });
      setScanWarnings(discovery.warnings ?? []);
      setStaged({
        guildName: null,
        // Threads are deliberately not listed. Each one follows its parent's
        // destination server-side; asking about two hundred archived threads
        // one at a time is not a mapping step, it is a punishment.
        channels: (discovery.channels ?? [])
          .filter((channel) => channel.parent_discord_channel_id === null)
          .map((channel) => ({
            channelId: channel.discord_channel_id,
            channelName: channel.discord_channel_name,
            category: channel.discord_category,
          })),
        roles: (discovery.roles ?? []).map((role) => ({
          roleId: role.discord_role_id,
          roleName: role.discord_role_name,
        })),
        exportCount: 0,
        mediaCount: 0,
        resumedCount: 0,
        pendingUploads: 0,
      });
      setStep("channels");
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not start the import."),
      });
    }
  }, [acknowledged, source, importId, createImport, discoverChannels, toast]);

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
    if (!importId || !staged || !source) return;
    const channels = staged.channels.map((channel) => {
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
    });

    try {
      // Two endpoints, because the two paths mean different things by "map".
      // The upload path CREATES the channel set from what the browser parsed;
      // the bot path answers a set the server already discovered, and refuses a
      // channel that was not in it.
      if (source === "bot") {
        await setDiscoveredMapping.mutateAsync({ id: importId, channels });
      } else {
        await setChannelMapping.mutateAsync({ id: importId, channels });
      }
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

  const mappingPending =
    setChannelMapping.isPending || setDiscoveredMapping.isPending;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <header>
        <h2 className="text-lg font-semibold">{STEP_LABELS[step]}</h2>
        <StepDots
          current={Math.max(stepIndex, 0)}
          total={stepOrder.length}
          className="mt-4"
        />
      </header>

      <main className="mt-6 flex-1">
        {step === "source" ? (
          <SourceStep
            value={source}
            onChange={setSource}
            botAvailable={availability.data?.available === true}
          />
        ) : null}

        {step === "connect" ? (
          <ConnectStep
            handshake={handshake}
            onConnected={() => setStep("consent")}
          />
        ) : null}

        {step === "consent" ? (
          <ConsentStep acknowledged={acknowledged} onChange={setAcknowledged} />
        ) : null}

        {step === "upload" && importId ? (
          <UploadStep
            importId={importId}
            alreadyUploaded={alreadyUploaded}
            requestUrls={requestUrls}
            confirmUploads={confirmUploads}
            onStaged={setStaged}
          />
        ) : null}

        {step === "channels" && staged ? (
          <>
            {scanWarnings.length > 0 ? (
              /**
               * Shown, never swallowed. The commonest entry here is that
               * private archived threads could not be read — the bot is
               * installed read-only and Discord gates listing those behind a
               * permission that can also delete threads. An admin deciding
               * whether the migration is complete has to know that.
               */
              <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-sm font-medium">
                  Some things could not be read
                </p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {scanWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ChannelMappingStep
              channels={staged.channels}
              choices={channelChoices}
              onChange={setChannelChoices}
            />
          </>
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
            source={source ?? "upload"}
            channelChoices={channelChoices}
            roleChoices={roleChoices}
          />
        ) : null}
      </main>

      <footer className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
        {step === "source" ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button variant="ghost" onClick={goBack}>
            Back
          </Button>
        )}

        {step === "source" ? (
          <Button
            onClick={() =>
              setStep(source === "bot" ? "connect" : "consent")
            }
            disabled={!source}
          >
            Continue
          </Button>
        ) : null}

        {/* The connect step owns its own forward button — it cannot advance
            until Discord has actually answered. */}

        {step === "consent" ? (
          <Button
            onClick={() => void beginImport()}
            disabled={
              !acknowledged ||
              createImport.isPending ||
              discoverChannels.isPending
            }
          >
            {discoverChannels.isPending ? "Reading your server…" : "Continue"}
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
            disabled={!channelsReady || mappingPending}
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
