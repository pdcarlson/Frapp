"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DISCORD_CONNECT_MESSAGES,
  useCancelDiscordImport,
  useClearDiscordImport,
  useDeleteDiscordImport,
  useDiscordImport,
  useDiscordImports,
} from "@repo/hooks";
import { formatLocaleDate, formatLocaleDateTime } from "@repo/formatting";
import { isDiscordImportClearable } from "@repo/validation";
import { Can } from "@/components/shared/can";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SectionLabel } from "@/components/shared/section-label";
import { PageHeader } from "@/components/layout/page-header";
import {
  anyReadUncached,
  PermissionsOfflineSurface,
} from "@/components/shared/async-states";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
  NestedOffline,
} from "@/components/shared/nested-states";
import { denseListClassName } from "@/components/shared/table-controls";
import { StaleReadNotice } from "@/components/shared/stale-read-notice";
import {
  useConfirmDialog,
  type ConfirmRequest,
  type ConfirmResult,
} from "@/components/shared/confirm-dialog";
import {
  meterFillClassName,
  meterTrackClassName,
} from "@/components/shared/meter";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { ImportWizard, type WizardStep } from "./import-wizard";
import { ImportWatchPanel } from "./import-watch-panel";
import {
  importPercent,
  purgeProgress,
  type ImportRow,
} from "./import-progress";
import {
  DELETE_IMPORT_STARTED,
  deleteImportConfirmation,
  purgeLine,
} from "./delete-import-copy";
import type { ImportSource } from "./source-step";

const STATUS_VARIANT: Record<
  string,
  "success" | "warning" | "destructive" | "outline"
> = {
  completed: "success",
  running: "warning",
  ready: "warning",
  purging: "warning",
  failed: "destructive",
  cancelled: "outline",
  purged: "outline",
  draft: "outline",
};

/**
 * Statuses whose bot import has channel rows worth watching (#2857). Only a
 * bot import: an upload's rows record neither the order its parts ran in nor
 * a part it skipped, so its progress stays the message count.
 */
const WATCHABLE = new Set([
  "ready",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
/** Of those, the ones still moving: watched live rather than read once. */
const MOVING = new Set(["ready", "running"]);

/**
 * Discord import, admin-only.
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
  // import list with no idea whether anything happened.
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
  const [wizardOpen, setWizardOpen] = useState(resumingBotWizard);
  // A resume is spent when its wizard closes, whether cancelled or started.
  // Kept past that, every later New import reopened on the bot's connect step
  // instead of "Choose how", and its fresh connect step confirmed the one-time
  // handshake a second time, which the server had already spent.
  function closeWizard() {
    setWizardOpen(false);
    setResumingBotWizard(false);
    setHandshake(null);
  }
  // The import whose detail is polled, which keeps its row live, and the one
  // whose channel panel is open. Hiding the panel keeps the row live.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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
        Outside the `<Can>` so the permission-denied branch keeps the route's
        heading — the shell no longer supplies one (#2141). The denied card's
        `<CardTitle>` and the body's were that same title said twice, so both
        are gone; the denied card's `CardHeader` held nothing else.
      */}
      <PageHeader title="Discord Import" />
      <Can
        permission="channels:manage"
        deniedFallback={
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Importing a Discord archive needs channel management permission.
              </p>
            </CardContent>
          </Card>
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
          wizardOpen={wizardOpen}
          setWizardOpen={setWizardOpen}
          closeWizard={closeWizard}
          activeId={activeId}
          setActiveId={setActiveId}
          openId={openId}
          setOpenId={setOpenId}
          resumingBotWizard={resumingBotWizard}
          handshake={handshake}
        />
      </Can>
    </>
  );
}

type BodyProps = {
  wizardOpen: boolean;
  setWizardOpen: (open: boolean) => void;
  /** Closes the wizard and spends any `?wizard=bot` resume it opened with. */
  closeWizard: () => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  resumingBotWizard: boolean;
  handshake: string | null;
};

/**
 * The confirmation lives above the list's loading, offline and error branches
 * (#2944). The list polls every few seconds while a row is deleting, and a
 * dialog rendered inside a branch that can swap out would unmount with it and
 * settle as a cancel, so the admin's click on Delete import would vanish. Same
 * shape as the Settings pages. A failed poll no longer swaps a loaded list
 * (the error branch below needs no data at all), but the hoist costs nothing
 * and keeps the dialog independent of what the list decides to render.
 */
function DiscordImportBody(props: BodyProps) {
  const { confirm, confirmDialog } = useConfirmDialog();
  return (
    <>
      {confirmDialog}
      <DiscordImportList {...props} confirm={confirm} />
    </>
  );
}

function DiscordImportList({
  wizardOpen,
  setWizardOpen,
  closeWizard,
  activeId,
  setActiveId,
  openId,
  setOpenId,
  resumingBotWizard,
  handshake,
  confirm,
}: BodyProps & {
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult | null>;
}) {
  const { isOffline } = useNetwork();
  const imports = useDiscordImports();
  const active = useDiscordImport(activeId);
  const deleteImport = useDeleteDiscordImport();
  const cancelImport = useCancelDiscordImport();
  const clearImport = useClearDiscordImport();
  const { toast } = useToast();

  const paused = imports.isPending && imports.fetchStatus === "paused";

  // Above every state branch, and so above anything the list's own read can
  // do. The wizard reads nothing from the list, but it holds every choice the
  // admin has made (source, consent, mappings, cutoff) in its own state, so a
  // branch that unmounts it loses them: a list read that failed while another
  // import's deletion was being polled used to send the admin back to the
  // first step with nothing kept. On the page surface,
  // not in a card: it already holds itself to a centred 672px column with its
  // own step heading and footer rule.
  if (wizardOpen) {
    return (
      <ImportWizard
        initialSource={resumingBotWizard ? ("bot" as ImportSource) : null}
        initialStep={resumingBotWizard ? ("connect" as WizardStep) : undefined}
        handshake={handshake}
        onCancel={closeWizard}
        onStarted={(id) => {
          closeWizard();
          setActiveId(id);
          setOpenId(id);
        }}
      />
    );
  }

  // The nested family with `sole`: the whole-screen states paint `--card`,
  // which on this flush route redraws the card the route deleted, and each of
  // these is the page's only async state. The error used to take
  // `ErrorState`'s defaults, "Unable to load data" and "Please retry in a
  // moment.": a failure that names nothing ("data") and gives no reason, the
  // context-free shape `writing.md` §1 bans and §3's pattern rules out.
  if (isOffline && anyReadUncached(imports)) {
    return (
      <NestedOffline
        sole
        title="Imports unavailable offline"
        description="Reconnect to load your chapter's Discord imports."
        onRetry={() => void imports.refetch()}
      />
    );
  }
  if (imports.isLoading || paused) {
    return <NestedLoading sole message="Loading imports..." />;
  }
  // `data === undefined`, not `isError` alone: a failed background read keeps
  // the rows TanStack already holds, and while a deletion is being polled an
  // admin is watching those rows count down. Swapping them for an error that
  // blames their chapter access, over a read that will likely succeed on the
  // next poll, hid the meter and the Stop and Delete controls (the report
  // queue in Chat Admin draws the same line).
  if (imports.isError && imports.data === undefined) {
    return (
      <NestedError
        sole
        title="Couldn't load imports"
        description="Confirm your chapter access and retry."
        onRetry={() => void imports.refetch()}
      />
    );
  }

  const rows: ImportRow[] = imports.data ?? [];
  const activeRow: ImportRow | null = active.data ?? null;
  // The polled import's row reads its own detail query, not the list, and the
  // list stops polling once nothing is deleting. So a detail poll that keeps
  // failing (the API down, say) froze that row's meter with nothing on screen
  // to say so, while the list read stayed clean. Keyed on the id, not the
  // detail's data: a first fetch that fails leaves no data and arms no poll,
  // and the row then shows the list's last copy, which is just as stale.
  const activeStale = active.isError && rows.some((row) => row.id === activeId);
  // The polled import's row takes its detail copy, which polls faster than
  // the list, unless the list loaded since: both poll during a purge, and a
  // detail poll that keeps failing would otherwise hold the row on its last
  // copy (still "purging", no Clear) while the list already says "purged".
  const detailIsFreshest =
    (active.dataUpdatedAt ?? 0) >= (imports.dataUpdatedAt ?? 0);

  function retryReads() {
    void imports.refetch();
    if (active.isError) void active.refetch();
  }

  async function cancel(id: string) {
    try {
      await cancelImport.mutateAsync({ id });
      toast({ description: "Stopping the import." });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not stop the import."),
      });
    }
  }

  async function clear(id: string) {
    try {
      await clearImport.mutateAsync({ id });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Could not clear the import."),
      });
    }
  }

  // One click used to start an irreversible purge (#2944); the dialog names
  // what goes, from the row as it reads now.
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

  return (
    // Flush, not carded (`1f` pin 2: "one toolbar row, no wrapper card, no
    // description paragraph"). The card header held a narration paragraph,
    // "Bring your chapter's Discord history into Frapp as read-only archive
    // messages", which now explains the empty list instead, where an admin
    // with nothing imported yet is the one reader who needs it.
    <section aria-labelledby="discord-imports-label" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <SectionLabel
          id="discord-imports-label"
          count={
            rows.length > 0
              ? `${rows.length} import${rows.length === 1 ? "" : "s"}`
              : null
          }
        >
          Imports
        </SectionLabel>
        <Button onClick={() => setWizardOpen(true)}>New import</Button>
      </div>
      {/*
        The rows a failed read leaves on screen are its last good ones, so say
        so: a deletion's meter that stopped moving otherwise reads as stuck
        rather than stale.
      */}
      <StaleReadNotice
        stale={imports.isError || activeStale}
        message="Couldn't refresh the imports. This is the last update that loaded."
        onRetry={retryReads}
      />
      {rows.length === 0 ? (
        <NestedEmpty
          sole
          title="No imports yet"
          description="Bring your chapter's Discord history in as read-only archive messages."
        />
      ) : (
        // Rows are text plus trailing controls, so they take the 44px floor
        // and the list's own dividers rather than a bordered box each.
        <ul className={denseListClassName}>
          {rows.map((row) => {
            const live =
              activeRow?.id === row.id && detailIsFreshest ? activeRow : row;
            // A deleting row counts its messages down (#2944); the meter
            // then shows how much is gone rather than how much came in.
            const deletion = purgeLine(live);
            const deleting = purgeProgress(live);
            const percent =
              importPercent(live) ??
              (deleting && deleting.left > 0 ? deleting.percent : null);
            const watchable =
              live.source === "bot" && WATCHABLE.has(live.status);
            // Open only while it is also the polled import: a panel on a
            // row whose status no longer updates would poll for ever.
            const watching =
              openId === row.id && activeId === row.id && watchable;
            return (
              <li key={row.id} className="min-h-11 space-y-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {live.guild_name ?? "Discord server"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatLocaleDateTime(live.created_at)}
                      {/* A partial import says so (#2858). */}
                      {live.messages_after
                        ? ` · Messages since ${formatLocaleDate(live.messages_after)}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[live.status] ?? "outline"}>
                    {live.status}
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    {deletion !== null ? (
                      <span>{deletion}</span>
                    ) : (
                      <span>
                        {live.imported_messages} messages
                        {live.attachments_imported > 0
                          ? ` · ${live.attachments_imported} attachments`
                          : ""}
                        {typeof live.channels_total === "number" &&
                        live.channels_total > 0
                          ? ` · ${live.channels_done ?? 0} of ${live.channels_total} channels and threads`
                          : ""}
                        {/* A deletion that failed part-way (#2944): the
                                totals above include what it already removed. */}
                        {(live.purged_messages ?? 0) > 0
                          ? ` · ${live.purged_messages} already deleted`
                          : ""}
                      </span>
                    )}
                    {/* The bar is aria-hidden; this is the accessible signal. */}
                    {percent !== null ? <span>{percent}%</span> : null}
                  </div>
                  {percent !== null ? (
                    <div aria-hidden="true" className={meterTrackClassName}>
                      <div
                        className={meterFillClassName}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  ) : null}
                </div>

                {live.error ? (
                  <p className="text-xs text-destructive-text">{live.error}</p>
                ) : null}

                {live.warnings?.length > 0 ? (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      {live.warnings.length} warning(s)
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {live.warnings.slice(0, 20).map((warning, i) => (
                        <li key={`${row.id}-w-${i}`}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {watching ? (
                  <ImportWatchPanel
                    importId={row.id}
                    active={MOVING.has(live.status)}
                  />
                ) : null}

                <div className="flex justify-end gap-2">
                  {/* Watch opens the import channel by channel (#2857);
                          on a finished import the same panel is its details. */}
                  {watching ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded="true"
                      onClick={() => setOpenId(null)}
                    >
                      Hide
                    </Button>
                  ) : watchable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded="false"
                      onClick={() => {
                        setActiveId(row.id);
                        setOpenId(row.id);
                      }}
                    >
                      {MOVING.has(live.status) ? "Watch" : "Details"}
                    </Button>
                  ) : activeId !== row.id && MOVING.has(live.status) ? (
                    // An upload: Watch keeps its message count live.
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveId(row.id)}
                    >
                      Watch
                    </Button>
                  ) : null}
                  {/* Delete refuses while an import is running and says to
                          cancel first, so the cancel affordance has to exist —
                          otherwise the recovery path the API describes is not
                          reachable from the product. */}
                  {live.status === "running" || live.status === "ready" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void cancel(row.id)}
                      disabled={cancelImport.isPending}
                    >
                      Stop import
                    </Button>
                  ) : null}
                  {/* Only a deleted import is cleared: this list is where
                          Delete lives, so one still holding what it brought
                          in must stay on it. */}
                  {isDiscordImportClearable(live.status) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void clear(row.id)}
                      disabled={clearImport.isPending}
                    >
                      Clear
                    </Button>
                  ) : null}
                  {live.status !== "purged" &&
                  live.status !== "purging" &&
                  live.status !== "running" ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void purge(live)}
                      disabled={deleteImport.isPending}
                    >
                      Delete import
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
