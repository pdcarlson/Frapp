"use client";

import { useCallback, useMemo, useState } from "react";
import {
  useConfirmDiscordUploads,
  useCreateDiscordImport,
  useDiscordAvailability,
  useChannels,
  useDiscordConnection,
  useDiscordImportFiles,
  useDiscoverDiscordChannels,
  useMyPermissions,
  useRequestDiscordUploadUrls,
  useRoles,
  useSetDiscordChannelMapping,
  useSetDiscordRoleMapping,
  useSetDiscoveredChannelMapping,
  useStartDiscordImport,
} from "@repo/hooks";
import { can, ROLE_NAME_MAX_LENGTH } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { StepDots } from "@/components/onboarding/step-dots";
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";
import { ConsentStep } from "./consent-step";
import { SourceStep, type ImportSource } from "./source-step";
import { ConnectStep } from "./connect-step";
import {
  UploadStep,
  type StagedChannel,
  type StagedExport,
} from "./upload-step";
import { ChannelMappingStep, type ChannelChoice } from "./channel-mapping-step";
import { mappingIssues, restageChoices } from "./mapping-issues";
import { RoleMappingStep, type RoleStepLock } from "./role-mapping-step";
import {
  defaultRoleChoice,
  privateReads,
  roleIssues,
  sameAsDiscordReaders,
  type FrappRole,
  type MatchKind,
  type RoleChoice,
} from "./role-matching";
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
 * the Frapp bot and let the API read the server) or `upload` (bring a
 * DiscordChatExporter export). Everything on either side of that is shared
 * verbatim: the same consent gate, the same channel mapping, the same review.
 * Only the bot path maps roles, because only the bot can read them: an export
 * names no roles and carries no permissions.
 *
 * The upload path is **not** a fallback that switches on when the bot is
 * unavailable. It is a supported choice, offered every time, because it is what
 * keeps working if Discord ever throttles one shared bot across every chapter.
 */
export type WizardStep =
  "source" | "connect" | "consent" | "upload" | "channels" | "roles" | "review";

/**
 * Both orders, spelled out rather than computed.
 *
 * `connect` sits BEFORE `consent` on the bot path and that ordering is
 * load-bearing, not cosmetic: creating a bot import resolves the chapter's
 * guild server-side, so the API refuses one for a chapter that has not
 * connected yet. Leaving `consent` is what mints the import on both paths.
 *
 * `roles` sits BEFORE `channels` for the same kind of reason (#2818): a
 * private channel defaults to "Same as Discord", which is the Frapp roles its
 * Discord roles map to, and the API resolves that through the saved mapping.
 */
const STEP_ORDERS: Record<ImportSource, WizardStep[]> = {
  bot: ["source", "connect", "consent", "roles", "channels", "review"],
  upload: ["source", "consent", "upload", "channels", "review"],
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
  const [botAccessGiven, setBotAccessGiven] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedExport | null>(null);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [channelChoices, setChannelChoices] = useState<
    Record<string, ChannelChoice>
  >({});
  // Only the roles the admin changed; the rest read their default, which
  // depends on the Frapp roles and on who could read what.
  const [roleEdits, setRoleEdits] = useState<Record<string, RoleChoice>>({});

  const availability = useDiscordAvailability();
  const botConnection = useDiscordConnection();
  // Availability is about STARTING a connect. A chapter that is already
  // connected can import whatever it says: the import reads through the bot
  // token and the stored guild, and fails loudly on its own if the token is
  // dead. Gating it on availability would block an import the API accepts
  // just because, say, the portal lost a redirect row nobody now needs.
  const botUsable =
    availability.data?.available === true ||
    botConnection.data?.connected === true;
  const createImport = useCreateDiscordImport();
  const requestUrls = useRequestDiscordUploadUrls();
  const confirmUploads = useConfirmDiscordUploads();
  const discoverChannels = useDiscoverDiscordChannels();
  const setChannelMapping = useSetDiscordChannelMapping();
  const setDiscoveredMapping = useSetDiscoveredChannelMapping();
  const setRoleMapping = useSetDiscordRoleMapping();
  const frappRolesQuery = useRoles();
  const myPermissions = useMyPermissions();
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
   * Stage a channel set and start every channel at its default answer.
   *
   * On a re-stage (a second scan after giving the bot access, or a resumed
   * upload) a choice survives only while the facts it was made under still
   * hold; `restageChoices` says which.
   */
  const stage = useCallback(
    (next: StagedExport) => {
      const previousChannels = staged?.channels ?? [];
      setChannelChoices((previous) =>
        restageChoices(previousChannels, previous, next.channels),
      );
      setStaged(next);
    },
    [staged],
  );

  /** Scan the connected server and stage what it found. */
  const scan = useCallback(
    async (id: string) => {
      const discovery = await discoverChannels.mutateAsync({ id });
      setScanWarnings(discovery.warnings ?? []);
      const found = discovery.channels ?? [];
      // A private thread's messages land wherever its parent goes, so the
      // parent is asked about as if it were private.
      const privateThreads = new Map<string, number>();
      for (const channel of found) {
        const parent = channel.parent_discord_channel_id;
        if (parent === null || channel.private_in_discord !== true) continue;
        privateThreads.set(parent, (privateThreads.get(parent) ?? 0) + 1);
      }
      stage({
        guildName: null,
        // Threads are deliberately not listed. Each one follows its parent's
        // destination server-side; asking about two hundred archived threads
        // one at a time is not a mapping step, it is a punishment.
        channels: found
          .filter((channel) => channel.parent_discord_channel_id === null)
          .map((channel) => ({
            channelId: channel.discord_channel_id,
            channelName: channel.discord_channel_name,
            category: channel.discord_category,
            readable: channel.readable ?? null,
            privateInDiscord: channel.private_in_discord ?? null,
            privateThreads: privateThreads.get(channel.discord_channel_id) ?? 0,
            readerRoleIds: channel.discord_reader_role_ids ?? null,
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
    },
    [discoverChannels, stage],
  );

  async function rescan() {
    if (!importId) return;
    try {
      await scan(importId);
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not scan the server again."),
      });
    }
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

      await scan(createdId);
      setStep("roles");
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not start the import."),
      });
    }
  }, [acknowledged, source, importId, createImport, scan, toast]);

  // The role step's answers: what the admin changed, over each role's
  // default. A viewer who cannot manage roles keeps every role on Ignore,
  // the only mapping the API takes from them.
  const frappRoles = useMemo<FrappRole[]>(
    () =>
      asArray<{ id?: unknown; name?: unknown; system_key?: unknown }>(
        frappRolesQuery.data,
      ).flatMap((role) =>
        typeof role.id === "string" && typeof role.name === "string"
          ? [
              {
                id: role.id,
                name: role.name,
                system_key:
                  typeof role.system_key === "string" ? role.system_key : null,
              },
            ]
          : [],
      ),
    [frappRolesQuery.data],
  );
  // Mapping a role needs both the permission and the chapter's roles to map
  // it to. Without either, every role stays on Ignore and the step says why:
  // an all-Ignore mapping is still a valid one, so a viewer who cannot read
  // the roles list (it needs members:view) can still finish the import.
  const holdsRolesManage = can("roles:manage", myPermissions.data?.permissions);
  const rolesLock: RoleStepLock | null = myPermissions.isError
    ? { reason: "unavailable", retry: () => void myPermissions.refetch() }
    : myPermissions.data !== undefined && !holdsRolesManage
      ? { reason: "permission" }
      : frappRolesQuery.data === undefined && frappRolesQuery.isError
        ? {
            reason: "unavailable",
            retry: () => void frappRolesQuery.refetch(),
          }
        : null;
  const canManageRoles = holdsRolesManage && frappRolesQuery.data !== undefined;
  const readsPrivate = useMemo(
    () => privateReads(staged?.channels ?? []),
    [staged],
  );
  const { roleChoices, roleMatches } = useMemo(() => {
    const choices: Record<string, RoleChoice> = {};
    const matches: Record<string, MatchKind> = {};
    for (const role of staged?.roles ?? []) {
      const edited = canManageRoles ? roleEdits[role.roleId] : undefined;
      if (edited) {
        choices[role.roleId] = edited;
        matches[role.roleId] = null;
        continue;
      }
      const fallback = defaultRoleChoice(
        role,
        frappRoles,
        (readsPrivate.get(role.roleId) ?? 0) > 0,
        canManageRoles,
      );
      choices[role.roleId] = fallback.choice;
      matches[role.roleId] = fallback.kind;
    }
    return { roleChoices: choices, roleMatches: matches };
  }, [staged, roleEdits, frappRoles, readsPrivate, canManageRoles]);
  const roleProblems = useMemo(
    () =>
      roleIssues(
        staged?.roles ?? [],
        roleChoices,
        frappRoles,
        ROLE_NAME_MAX_LENGTH,
      ),
    [staged, roleChoices, frappRoles],
  );
  // Defaults are only right once it is settled whether roles can be mapped
  // and, when they can, what they map to; until then, Continue waits.
  const rolesLoaded = rolesLock !== null || canManageRoles;
  const readersOf = useCallback(
    (channel: StagedChannel) =>
      sameAsDiscordReaders(
        channel,
        staged?.roles ?? [],
        roleChoices,
        frappRoles,
      ),
    [staged, roleChoices, frappRoles],
  );

  const existingChannels = useChannels();
  // One list decides both whether Continue is enabled and what Needs
  // attention shows, so the step can never be blocked for a reason it does
  // not state. A same-name Frapp channel is an issue, never a merge:
  // `chat_channels` has no unique (chapter_id, name). Until the existing
  // channels have loaded once, a clash cannot be ruled out, so that is an
  // issue too rather than a silent pass. A later refetch that fails keeps the
  // list it already had, which is still good enough to check against.
  // Retrying in place, never reloading: the whole wizard lives in this
  // component's state, and a reload would throw every answer away.
  const refetchChannels = existingChannels.refetch;
  const channelIssues = useMemo(() => {
    if (!staged) return [];
    const issues = mappingIssues(
      staged.channels,
      channelChoices,
      asArray<{ name: string }>(existingChannels.data).map(
        (channel) => channel.name,
      ),
      readersOf,
    );
    if (existingChannels.data === undefined) {
      issues.unshift(
        existingChannels.isError
          ? {
              channelId: null,
              message:
                "Frapp could not load your existing channels to check the new names against.",
              retry: () => void refetchChannels(),
            }
          : {
              channelId: null,
              message: "Checking the new names against your existing channels…",
            },
      );
    }
    return issues;
  }, [
    staged,
    channelChoices,
    existingChannels.data,
    existingChannels.isError,
    refetchChannels,
    readersOf,
  ]);
  const channelsReady = !!staged && channelIssues.length === 0;

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
        // Only a new channel has a visibility; the API refuses one that was
        // (or may have been) private in Discord without one, so it is sent
        // as chosen. "Same as Discord" sends no permissions: the API works
        // them out from the saved role mapping.
        new_channel_visibility:
          choice.action === "create_new" ? choice.visibility : undefined,
        new_channel_required_permissions:
          choice.action === "create_new" && choice.visibility === "restricted"
            ? (choice.requiredPermissions ?? [])
            : undefined,
        message_count: 0,
      };
    });

    try {
      // Two endpoints, because the two paths mean different things by "map".
      // The upload path CREATES the channel set from what the browser parsed;
      // the bot path answers a set the server already discovered, and refuses a
      // channel that was not in it.
      if (source === "bot") {
        await saveRoles();
        await setDiscoveredMapping.mutateAsync({ id: importId, channels });
      } else {
        await setChannelMapping.mutateAsync({ id: importId, channels });
      }
      setStep("review");
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

  /**
   * Save the role step's answers. A "Same as Discord" channel is resolved
   * through the saved mapping, so it is saved on leaving the role step and
   * again just before the channels: a re-scan on the channel step can change
   * which roles could read what, and with it the defaults the page shows.
   */
  async function saveRoles() {
    if (!importId || !staged) return;
    await setRoleMapping.mutateAsync({
      id: importId,
      roles: staged.roles.map((role) => {
        const choice = roleChoices[role.roleId] ?? { action: "ignore" };
        return {
          discord_role_id: role.roleId,
          discord_role_name: role.roleName,
          action: choice.action,
          frapp_role_id:
            choice.action === "existing" ? choice.roleId : undefined,
          new_role_name:
            choice.action === "new" ? choice.name.trim() : undefined,
        };
      }),
    });
  }

  async function submitRoles() {
    try {
      await saveRoles();
      setStep("channels");
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not save the role mapping."),
      });
    }
  }

  async function submitStart() {
    if (!importId) return;
    try {
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
    setChannelMapping.isPending ||
    setDiscoveredMapping.isPending ||
    setRoleMapping.isPending;

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
            botAvailable={botUsable}
          />
        ) : null}

        {step === "connect" ? (
          <ConnectStep
            handshake={handshake}
            accessGiven={botAccessGiven}
            onAccessGivenChange={setBotAccessGiven}
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
            onStaged={stage}
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
              issues={channelIssues}
              knowsPrivacy={source === "bot"}
              readersOf={readersOf}
              onRescan={source === "bot" ? () => void rescan() : undefined}
              rescanning={discoverChannels.isPending}
            />
          </>
        ) : null}

        {step === "roles" && staged ? (
          rolesLoaded ? (
            <RoleMappingStep
              roles={staged.roles}
              choices={roleChoices}
              matches={roleMatches}
              privateReads={readsPrivate}
              frappRoles={frappRoles}
              issues={roleProblems}
              lock={rolesLock}
              onChange={(roleId, next) =>
                setRoleEdits((previous) => ({ ...previous, [roleId]: next }))
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Loading your Frapp roles…
            </p>
          )
        ) : null}

        {step === "review" && staged ? (
          <ReviewStep
            staged={staged}
            source={source ?? "upload"}
            channelChoices={channelChoices}
            roles={staged.roles}
            roleChoices={roleChoices}
            readersOf={readersOf}
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
            onClick={() => setStep(source === "bot" ? "connect" : "consent")}
            // `source` survives the card greying out: an admin who picked the
            // bot, went on, and came Back after the API withdrew it would
            // otherwise be sent straight back to a connect that cannot work.
            disabled={!source || (source === "bot" && !botUsable)}
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
          <Button
            onClick={() => void submitRoles()}
            disabled={
              !rolesLoaded ||
              roleProblems.length > 0 ||
              setRoleMapping.isPending
            }
          >
            Continue
          </Button>
        ) : null}

        {step === "review" ? (
          <Button
            onClick={() => void submitStart()}
            disabled={startImport.isPending}
          >
            Start import
          </Button>
        ) : null}
      </footer>
    </div>
  );
}
