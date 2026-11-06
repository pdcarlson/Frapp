"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DISCORD_CONNECT_MESSAGES,
  useCancelDiscordImport,
  useClearDiscordImport,
  useDeleteDiscordImport,
  useDiscordImports,
  useStartDiscordImport,
} from "@repo/hooks";
import { Can } from "@/components/shared/can";
import { Button } from "@/components/ui/button";
import {
  anyReadUncached,
  PermissionsOfflineSurface,
} from "@/components/shared/async-states";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { StaleReadNotice } from "@/components/shared/stale-read-notice";
import {
  useConfirmDialog,
  type ConfirmRequest,
  type ConfirmResult,
} from "@/components/shared/confirm-dialog";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { ImportWizard, type WizardStep } from "./import-wizard";
import { ImportWatchPanel } from "./import-watch-panel";
import type { ImportRow } from "./import-progress";
import {
  DELETE_IMPORT_STARTED,
  deleteImportConfirmation,
} from "./delete-import-copy";
import type { ImportSource } from "./source-step";
import { currentImport, importStage } from "./current-import";
import {
  ImportDeleting,
  ImportFinished,
  ImportLanding,
  ImportRunning,
} from "./import-states";
import { useBotUsable } from "./use-bot-usable";
import { DiscordImportSkeleton } from "./discord-import-skeleton";

/** Where the wizard opens: the step after "Choose how" for a picked source. */
type WizardStart = { source: ImportSource | null; step: WizardStep };

const FIRST_STEP: Record<ImportSource, WizardStep> = {
  bot: "connect",
  upload: "consent",
};

/**
 * Discord import, admin-only: the chapter's one import (#2882 redesign), in
 * the state it is in. Nothing imported yet shows what comes over and the two
 * ways in; a running import counts up; a finished one says what came over and
 * what didn't; a deleting one counts down. A chapter moves off Discord once,
 * and the API refuses a second import while the first still holds its
 * messages, so there is no list of jobs.
 *
 * Gate ordering is permission → network → data: every async state renders
 * *inside* `<Can>`, so a member who URL-hits this route is told they cannot see
 * it rather than watching a spinner for a surface they will never reach.
 */
export function DiscordImportPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // `?wizard=bot` is set by the Discord connect step's return path, so the
  // browser coming back from Discord lands where it left off rather than on the
  // page's start with no idea whether anything happened.
  //
  // Both of these are read ONCE into state, not on every render. The effect
  // below strips the params, and Next patches `replaceState` so
  // `useSearchParams()` re-renders without them — while the wizard is still
  // behind `<Can>`'s permission read and has not mounted (the browser is back
  // from Discord on a full page load, so that read starts uncached). Read live,
  // it would mount a moment later with both already gone: the admin who just
  // authorized would land on "Choose how", and the one-time token that
  // activates their server would be lost.
  const [resumingBotWizard, setResumingBotWizard] = useState(
    () => searchParams.get("wizard") === "bot",
  );
  const [handshake, setHandshake] = useState(() =>
    searchParams.get("handshake"),
  );
  const [wizard, setWizard] = useState<WizardStart | null>(
    resumingBotWizard ? { source: "bot", step: "connect" } : null,
  );
  // A resume is spent when its wizard closes, whether cancelled or started.
  // Kept past that, a later start reopened on the bot's connect step, and its
  // fresh connect step confirmed the one-time handshake a second time, which
  // the server had already spent.
  function closeWizard() {
    setWizard(null);
    setResumingBotWizard(false);
    setHandshake(null);
  }

  /**
   * Report the outcome of a connect attempt, exactly once.
   *
   * `?discord=` carries a CODE, never text — the API deliberately does not put
   * `error_description` on the URL, because that string is chosen by an outside
   * party and rendering supplied text inside our own chrome is a phishing
   * surface. The sentences live in `DISCORD_CONNECT_MESSAGES`.
   *
   * The params are stripped afterwards so a refresh does not re-announce a
   * result from ten minutes ago.
   */
  const announced = useRef(false);
  const outcome = searchParams.get("discord");
  useEffect(() => {
    if (announced.current || !outcome) return;
    announced.current = true;

    // `pending` is not an outcome to announce — the callback parked a guild and
    // the connect step is about to confirm it and report what actually
    // happened. Toasting here would tell the admin something before it is true.
    const known =
      outcome === "pending" ? undefined : DISCORD_CONNECT_MESSAGES[outcome];
    if (known) {
      toast({
        variant: known.variant === "error" ? "destructive" : undefined,
        description: known.message,
      });
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("discord");
    url.searchParams.delete("wizard");
    // Stripped from the address bar promptly: it is a one-time credential, and
    // a URL is the most-copied, most-shoulder-surfed place a value can sit.
    // Spending it does not depend on it staying here — it was read into state
    // on the first render.
    url.searchParams.delete("handshake");
    window.history.replaceState(null, "", url.toString());
  }, [outcome, toast]);

  return (
    <>
      {/*
        The route's heading is the top bar's (`top-bar.tsx`). The denied
        card's `<CardTitle>` and the body's were that same title said again, so
        both are gone, and so is the card that framed the one denied sentence.
      */}
      <Can
        permission="channels:manage"
        fallback={<DiscordImportSkeleton />}
        deniedFallback={
          <p className="text-sm text-muted-foreground">
            Your role can&apos;t import Discord history. Ask your chapter
            president for access.
          </p>
        }
        // A paused permission read is not a denial (`writing.md` §7,
        // "Permission check offline"). Without this the screen-level gate fell
        // back to the control-slot chip, one line of text standing in for the
        // page. The card it draws instead is the same screen-level fallback
        // every flushed route's gate draws (`/reports`, `/geofences`).
        offlineFallback={(retry) => (
          <PermissionsOfflineSurface
            description="Reconnect to check whether you can import Discord history."
            onRetry={retry}
          />
        )}
      >
        <DiscordImportBody
          wizard={wizard}
          openWizard={setWizard}
          closeWizard={closeWizard}
          handshake={handshake}
        />
      </Can>
    </>
  );
}

type BodyProps = {
  wizard: WizardStart | null;
  openWizard: (start: WizardStart) => void;
  /** Closes the wizard and spends any `?wizard=bot` resume it opened with. */
  closeWizard: () => void;
  handshake: string | null;
};

/**
 * The confirmation lives above the page's loading, offline and error branches
 * (#2944). The import is polled every few seconds while it is moving, and a
 * dialog rendered inside a branch that can swap out would unmount with it and
 * settle as a cancel, so the admin's click on Delete import would vanish.
 */
function DiscordImportBody(props: BodyProps) {
  const { confirm, confirmDialog } = useConfirmDialog();
  return (
    <>
      {confirmDialog}
      <DiscordImportView {...props} confirm={confirm} />
    </>
  );
}

function DiscordImportView({
  wizard,
  openWizard,
  closeWizard,
  handshake,
  confirm,
}: BodyProps & {
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult | null>;
}) {
  const { isOffline } = useNetwork();
  const imports = useDiscordImports();
  const deleteImport = useDeleteDiscordImport();
  const cancelImport = useCancelDiscordImport();
  const clearImport = useClearDiscordImport();
  const startImport = useStartDiscordImport();
  const botAvailable = useBotUsable();
  const { toast } = useToast();
  // The channel-by-channel panel (#2857), opened from the import's own page.
  const [channelsOpen, setChannelsOpen] = useState(false);

  const paused = imports.isPending && imports.fetchStatus === "paused";

  // Above every state branch, and so above anything the page's own read can
  // do. The wizard holds every choice the admin has made (source, consent,
  // mappings, cutoff) in its own state, so a branch that unmounts it loses
  // them. On the page surface, not in a card: it already holds itself to a
  // centred 672px column with its own step heading and footer rule.
  if (wizard) {
    return (
      <ImportWizard
        initialSource={wizard.source}
        initialStep={wizard.step}
        handshake={handshake}
        onCancel={closeWizard}
        onStarted={() => {
          closeWizard();
          // The new import is on the page once the list reads it; the start
          // mutation refreshes the list.
          setChannelsOpen(false);
        }}
      />
    );
  }

  // The nested family with `sole`: the whole-screen states paint `--card`,
  // which on this flush route redraws the card the route deleted, and each of
  // these is the page's only async state.
  if (isOffline && anyReadUncached(imports)) {
    return (
      <NestedOffline
        sole
        title="Import unavailable offline"
        description="Reconnect to load your chapter's Discord import."
        onRetry={() => void imports.refetch()}
      />
    );
  }
  if (imports.isLoading || paused) {
    return <DiscordImportSkeleton />;
  }
  // `data === undefined`, not `isError` alone: a failed background read keeps
  // what TanStack already holds, and while a deletion is being polled an admin
  // is watching it count down. Swapping that for an error that blames their
  // chapter access, over a read that will likely succeed on the next poll,
  // hid the meter and the controls.
  if (imports.isError && imports.data === undefined) {
    return (
      <NestedError
        sole
        title="Couldn't load the import"
        description="Check your connection and retry."
        onRetry={() => void imports.refetch()}
      />
    );
  }

  const rows: ImportRow[] = imports.data ?? [];
  const { current, lastDeleted, unfinished } = currentImport(rows);

  async function stop(row: ImportRow) {
    try {
      await cancelImport.mutateAsync({ id: row.id });
      toast({ description: "Stopping the import." });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not stop the import."),
      });
    }
  }

  // A failed import picks up where it stopped (#2947 tracks the restart's
  // remaining gaps); its cutoff and mappings are kept.
  async function resume(row: ImportRow) {
    try {
      await startImport.mutateAsync({ id: row.id });
      toast({ description: "Resuming the import." });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not resume the import."),
      });
    }
  }

  async function dismiss(row: ImportRow) {
    try {
      await clearImport.mutateAsync({ id: row.id });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not clear the import."),
      });
    }
  }

  // One click used to start an irreversible purge (#2944); the dialog names
  // what goes, from the import as it reads now.
  async function purge(row: ImportRow) {
    if (!(await confirm(deleteImportConfirmation(row)))) return;
    try {
      await deleteImport.mutateAsync({ id: row.id });
      toast({ description: DELETE_IMPORT_STARTED });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not delete the import."),
      });
    }
  }

  // A bot import's channel panel (#2857). An upload's channel rows record
  // neither the order its parts ran in nor a part it skipped, so its progress
  // stays the message count.
  function channels(row: ImportRow, moving: boolean) {
    if (row.source !== "bot") return null;
    return (
      <div className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={channelsOpen}
          onClick={() => setChannelsOpen((open) => !open)}
        >
          {channelsOpen ? "Hide channels" : "See every channel"}
        </Button>
        {channelsOpen ? (
          <ImportWatchPanel importId={row.id} active={moving} />
        ) : null}
      </div>
    );
  }

  const stage = current ? importStage(current) : null;

  return (
    <div className="space-y-4">
      {/*
        What a failed refresh leaves on screen is the last good read, so say
        so: a meter that stopped moving otherwise reads as stuck rather than
        stale.
      */}
      <StaleReadNotice
        stale={imports.isError}
        message="Couldn't refresh the import. This is the last update that loaded."
        onRetry={() => void imports.refetch()}
      />
      {current === null ? (
        <ImportLanding
          botAvailable={botAvailable}
          onPick={(source) => openWizard({ source, step: FIRST_STEP[source] })}
          lastDeleted={lastDeleted}
          onDismissDeleted={() => lastDeleted && void dismiss(lastDeleted)}
          unfinished={unfinished}
          onDeleteUnfinished={() => unfinished && void purge(unfinished)}
          deleting={deleteImport.isPending}
        />
      ) : stage === "importing" ? (
        <ImportRunning
          row={current}
          onStop={() => void stop(current)}
          stopping={cancelImport.isPending}
          channels={channels(current, true)}
        />
      ) : stage === "deleting" ? (
        <ImportDeleting row={current} />
      ) : (
        <ImportFinished
          row={current}
          onDelete={() => void purge(current)}
          deleting={deleteImport.isPending}
          onResume={() => void resume(current)}
          resuming={startImport.isPending}
          channels={channels(current, false)}
        />
      )}
    </div>
  );
}
