"use client";

import { useId, useState } from "react";
import { Copy, ExternalLink, FolderSync, Loader2 } from "lucide-react";
import {
  useConnectGoogleDrive,
  useDisconnectGoogleDrive,
  useGoogleDriveStatus,
  useSyncGoogleDrive,
  type GoogleDriveStatus,
} from "@repo/hooks";
import { formatRelativeDayTime } from "@repo/formatting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/panel";
import {
  useGatedDialog,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/**
 * Connect the chapter's Google Drive folder to Documents, and see and manage
 * it once connected (#5157; `spec/behavior/chapter-docs.md` § Google Drive
 * folder). For officers with Manage documents; hidden while this server has
 * no service account and nothing is connected.
 *
 * Comparable: Notion's and Slack's Google Drive connections, which also ask
 * for the folder and then show its last sync with a Sync now control.
 */
export function DriveFolderPanel({ gate }: { gate: SubscriptionGate }) {
  const status = useGoogleDriveStatus();
  const dialog = useGatedDialog(gate);
  const data = status.data;
  if (!data || (!data.available && !data.connection)) return null;
  const connected = data.connection;

  return (
    <>
      <Button
        variant="secondary"
        size="toolbar"
        className="gap-2"
        onClick={() => dialog.setOpen(true)}
        {...gate.controlProps()}
      >
        <FolderSync className="h-4 w-4" />
        {connected ? "Google Drive" : "Connect Google Drive"}
        {connected?.status === "no_access" ? (
          <span className="sr-only">: needs attention</span>
        ) : null}
        {connected?.status === "no_access" ? (
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-destructive"
          />
        ) : null}
      </Button>
      <Panel {...dialog.dialogProps} docked backLabel="Back to documents">
        <PanelContent {...dialog.contentProps} aria-describedby={undefined}>
          {connected ? (
            <ConnectedView
              status={data}
              gate={gate}
              onClose={() => dialog.setOpen(false)}
            />
          ) : (
            <ConnectView
              email={data.service_account_email}
              gate={gate}
              onCancel={() => dialog.setOpen(false)}
            />
          )}
        </PanelContent>
      </Panel>
    </>
  );
}

function ConnectView({
  email,
  gate,
  onCancel,
}: {
  email: string | null;
  gate: SubscriptionGate;
  onCancel: () => void;
}) {
  const connect = useConnectGoogleDrive();
  const { toast } = useToast();
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!link.trim() || connect.isPending) return;
    setError(null);
    try {
      await connect.mutateAsync(link.trim());
      toast({
        title: "Google Drive connected",
        description: "Its files will show up in Documents in a minute or two.",
      });
    } catch (caught) {
      // The API writes each refusal for the officer (not a folder link,
      // not shared with Frapp yet, a file instead of a folder).
      setError(
        getErrorMessage(caught, "Couldn't connect. Try again.", {
          serverWritesForMembers: true,
        }),
      );
    }
  }

  return (
    <form className="contents" onSubmit={(event) => void submit(event)}>
      <PanelHeader>Connect Google Drive</PanelHeader>
      <PanelBody className="space-y-6">
        <p className="text-body text-muted-foreground">
          Every file in the folder shows up in Documents for everyone who can
          open Documents, and stays in sync as the folder changes. Google Docs
          and Slides come in as PDFs, and Sheets as Excel files.
        </p>
        <ol className="space-y-6">
          <li className="space-y-2">
            <p className="text-body font-medium">
              1. In Google Drive, share the folder with Frapp as a Viewer
            </p>
            {email ? <CopyAddress email={email} /> : null}
          </li>
          <li className="space-y-2">
            <Label htmlFor={inputId} className="text-body font-medium">
              2. Paste the folder&apos;s link
            </Label>
            <Input
              id={inputId}
              value={link}
              onChange={(event) => {
                setLink(event.target.value);
                setError(null);
              }}
              placeholder="https://drive.google.com/drive/folders/…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            {error ? (
              <p
                id={errorId}
                role="alert"
                className="text-caption text-destructive"
              >
                {error}
              </p>
            ) : null}
          </li>
        </ol>
      </PanelBody>
      <PanelFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!link.trim() || connect.isPending || !gate.allowed}
          aria-busy={connect.isPending}
        >
          {connect.isPending ? "Connecting…" : "Connect"}
        </Button>
      </PanelFooter>
    </form>
  );
}

function CopyAddress({ email }: { email: string }) {
  const { toast } = useToast();
  async function copy() {
    try {
      // Inside the try: without a secure context `navigator.clipboard` is
      // undefined and the call throws before any promise exists.
      await navigator.clipboard.writeText(email);
      toast({ description: "Address copied." });
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Select the address and copy it instead.",
      });
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
      <code className="min-w-0 flex-1 select-all truncate text-caption">
        {email}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5"
        onClick={() => void copy()}
      >
        <Copy className="h-3.5 w-3.5" /> Copy
      </Button>
    </div>
  );
}

function ConnectedView({
  status,
  gate,
  onClose,
}: {
  status: GoogleDriveStatus;
  gate: SubscriptionGate;
  onClose: () => void;
}) {
  const connection = status.connection!;
  const sync = useSyncGoogleDrive();
  const disconnect = useDisconnectGoogleDrive();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const syncing = connection.syncing || sync.isPending;
  const lastSynced = formatRelativeDayTime(connection.last_synced_at);

  async function syncNow() {
    try {
      await sync.mutateAsync();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't start a sync",
        description: getErrorMessage(error, "Try again in a moment."),
      });
    }
  }

  async function onDisconnect() {
    const ok = await confirm({
      title: `Disconnect ${connection.folder_name}?`,
      description:
        "Its files leave Documents within a minute. Nothing in Google Drive changes, and you can connect it again later.",
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await disconnect.mutateAsync();
      toast({ title: "Google Drive disconnected" });
      onClose();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't disconnect",
        description: getErrorMessage(error, "Try again in a moment."),
      });
    }
  }

  return (
    <>
      <PanelHeader>Google Drive</PanelHeader>
      <PanelBody className="space-y-6">
        <div className="space-y-1">
          <p className="text-body font-medium">{connection.folder_name}</p>
          <a
            href={connection.folder_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-caption text-muted-foreground underline-offset-4 hover:underline"
          >
            Open in Google Drive <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {connection.status === "no_access" ? (
          <div
            role="status"
            className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
          >
            <p className="text-body font-medium">
              Frapp can&apos;t see this folder any more
            </p>
            <p className="text-caption text-muted-foreground">
              It was unshared or deleted. Its files stay in Documents as they
              were. Share it with Frapp again to keep syncing, or disconnect it.
            </p>
            {status.service_account_email ? (
              <CopyAddress email={status.service_account_email} />
            ) : null}
          </div>
        ) : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
          <dt className="text-muted-foreground">Last synced</dt>
          <dd aria-live="polite">
            {/* The line keeps its width: "Syncing" replaces the time in place. */}
            {syncing ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
                Syncing
              </span>
            ) : (
              (lastSynced ?? "Not yet")
            )}
          </dd>
          <dt className="text-muted-foreground">In Documents</dt>
          <dd>{fileCount(connection.synced_count)}</dd>
          {connection.skipped_count > 0 ? (
            <>
              <dt className="text-muted-foreground">Left out</dt>
              <dd>
                {fileCount(connection.skipped_count)}
                <span className="block text-caption text-muted-foreground">
                  Forms and shortcuts, file types Documents doesn&apos;t take,
                  files over 25 MB, and files past the first 500.
                </span>
              </dd>
            </>
          ) : null}
        </dl>

        <p className="text-caption text-muted-foreground">
          Changes in the folder reach Documents within 15 minutes. Subfolders
          become folders here. To remove a file, remove it in Google Drive.
        </p>
      </PanelBody>
      <PanelFooter>
        <Button
          variant="secondary"
          onClick={() => void onDisconnect()}
          disabled={disconnect.isPending}
          aria-busy={disconnect.isPending}
        >
          Disconnect
        </Button>
        <Button
          onClick={() => void syncNow()}
          disabled={syncing || !gate.allowed}
          aria-busy={sync.isPending}
        >
          Sync now
        </Button>
      </PanelFooter>
      {confirmDialog}
    </>
  );
}

function fileCount(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}
