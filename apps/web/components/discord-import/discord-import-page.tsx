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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import {
  ErrorState,
  anyReadUncached,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import { NestedEmpty } from "@/components/shared/nested-states";
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
  // behind the imports query's loading state and has not mounted. Read live,
  // it would mount a moment later with both already gone: the admin who just
  // authorized would land on "Choose how", and the one-time token that
  // activates their server would be lost.
  const [resumingBotWizard] = useState(
    () => searchParams.get("wizard") === "bot",
  );
  const [handshake] = useState(() => searchParams.get("handshake"));
  const [wizardOpen, setWizardOpen] = useState(resumingBotWizard);
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
      >
        <DiscordImportBody
          wizardOpen={wizardOpen}
          setWizardOpen={setWizardOpen}
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
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  resumingBotWizard: boolean;
  handshake: string | null;
};

/**
 * The confirmation lives above the list's loading, offline and error branches
 * (#2944). The list polls every few seconds while a row is deleting, and one
 * failed poll swaps the list for its error state; a dialog rendered inside the
 * list would unmount with it and settle as a cancel, so the admin's click on
 * Delete import would vanish. Same shape as the Settings pages.
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

  if (isOffline && anyReadUncached(imports)) {
    return <OfflineState onRetry={() => void imports.refetch()} />;
  }
  if (imports.isLoading || paused) {
    return <LoadingState message="Loading imports…" />;
  }
  if (imports.isError) {
    return <ErrorState onRetry={() => void imports.refetch()} />;
  }

  const rows: ImportRow[] = imports.data ?? [];
  const activeRow: ImportRow | null = active.data ?? null;

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

  if (wizardOpen) {
    return (
      <Card>
        <CardContent className="pt-6">
          <ImportWizard
            initialSource={resumingBotWizard ? ("bot" as ImportSource) : null}
            initialStep={
              resumingBotWizard ? ("connect" as WizardStep) : undefined
            }
            handshake={handshake}
            onCancel={() => setWizardOpen(false)}
            onStarted={(id) => {
              setWizardOpen(false);
              setActiveId(id);
              setOpenId(id);
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              Bring your chapter’s Discord history into Frapp as read-only
              archive messages.
            </p>
          </div>
          <Button onClick={() => setWizardOpen(true)}>New import</Button>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <NestedEmpty
              title="No imports yet"
              description="Export your Discord server, then bring it in here."
            />
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => {
                const live = activeRow?.id === row.id ? activeRow : row;
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
                  <li
                    key={row.id}
                    className="space-y-2 rounded-lg border border-border p-3"
                  >
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
                      <p className="text-xs text-destructive-text">
                        {live.error}
                      </p>
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
        </CardContent>
      </Card>
    </div>
  );
}
