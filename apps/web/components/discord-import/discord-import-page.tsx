"use client";

import { useState } from "react";
import {
  useCancelDiscordImport,
  useDeleteDiscordImport,
  useDiscordImport,
  useDiscordImports,
} from "@repo/hooks";
import { Can } from "@/components/shared/can";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ErrorState,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import { NestedEmpty } from "@/components/shared/nested-states";
import {
  meterFillClassName,
  meterTrackClassName,
} from "@/components/shared/meter";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { ImportWizard } from "./import-wizard";

type ImportRow = {
  id: string;
  status: string;
  guild_name: string | null;
  total_messages: number;
  imported_messages: number;
  messages_skipped: number;
  attachments_imported: number;
  warnings: string[];
  error: string | null;
  created_at: string;
};

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
 * Discord import, admin-only.
 *
 * Gate ordering is permission → network → data: every async state renders
 * *inside* `<Can>`, so a member who URL-hits this route is told they cannot see
 * it rather than watching a spinner for a surface they will never reach.
 */
export function DiscordImportPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <Can
      permission="channels:manage"
      deniedFallback={
        <Card>
          <CardHeader>
            <CardTitle>Discord Import</CardTitle>
          </CardHeader>
          <CardContent>
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
      />
    </Can>
  );
}

function DiscordImportBody({
  wizardOpen,
  setWizardOpen,
  activeId,
  setActiveId,
}: {
  wizardOpen: boolean;
  setWizardOpen: (open: boolean) => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
}) {
  const { isOffline } = useNetwork();
  const imports = useDiscordImports();
  const active = useDiscordImport(activeId);
  const deleteImport = useDeleteDiscordImport();
  const cancelImport = useCancelDiscordImport();
  const { toast } = useToast();

  const ready = imports.data !== undefined;
  const paused = imports.isPending && imports.fetchStatus === "paused";

  if (isOffline && !ready) {
    return <OfflineState onRetry={() => void imports.refetch()} />;
  }
  if (imports.isLoading || paused) {
    return <LoadingState message="Loading imports…" />;
  }
  if (imports.isError) {
    return <ErrorState onRetry={() => void imports.refetch()} />;
  }

  const rows = (imports.data ?? []) as unknown as ImportRow[];
  const activeRow = (active.data ?? null) as ImportRow | null;

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

  async function purge(id: string) {
    try {
      await deleteImport.mutateAsync({ id });
      toast({
        description: "Deleting the import and everything it brought in.",
      });
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
            onCancel={() => setWizardOpen(false)}
            onStarted={(id) => {
              setWizardOpen(false);
              setActiveId(id);
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
            <CardTitle>Discord Import</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Bring your chapter’s Discord history into Signet as read-only
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
                const percent =
                  live.total_messages === 0
                    ? live.status === "completed"
                      ? 100
                      : 0
                    : Math.round(
                        (live.imported_messages / live.total_messages) * 100,
                      );
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
                          {new Date(live.created_at).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant={STATUS_VARIANT[live.status] ?? "outline"}>
                        {live.status}
                      </Badge>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {live.imported_messages} messages
                          {live.attachments_imported > 0
                            ? ` · ${live.attachments_imported} attachments`
                            : ""}
                        </span>
                        {/* The bar is aria-hidden; this is the accessible signal. */}
                        <span>{percent}%</span>
                      </div>
                      <div aria-hidden="true" className={meterTrackClassName}>
                        <div
                          className={meterFillClassName}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
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

                    <div className="flex justify-end gap-2">
                      {activeId !== row.id ? (
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
                      {live.status !== "purged" &&
                      live.status !== "purging" &&
                      live.status !== "running" ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void purge(row.id)}
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
