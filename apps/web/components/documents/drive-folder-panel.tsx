"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  FolderSync,
  Loader2,
} from "lucide-react";
import {
  useConnectGoogleDrive,
  useConnectPickedGoogleDrive,
  useDisconnectGoogleDrive,
  useGoogleDriveStatus,
  useOpenUpDriveCopy,
  useSyncGoogleDrive,
  type GoogleDriveStatus,
} from "@repo/hooks";
import { isEmptyChannelAccessChoice } from "@repo/hooks/channel-access";
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
import { ChannelAccessField } from "@/components/chat-admin/channel-access-field";
import {
  FOLDER_ALWAYS_LINE,
  useDocumentAccessChoices,
} from "@/components/documents/document-access";
import type {
  ChapterDocument,
  FolderRow,
} from "@/components/documents/document-types";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import {
  DrivePickerError,
  forgetDrivePickerSignIn,
  pickDriveFolder,
  preloadDrivePicker,
  type DrivePickerConfig,
  type PickedFolder,
} from "@/lib/google-drive-picker";

/**
 * Connect the chapter's Google Drive folder to Documents, and see and manage
 * it once connected (#5157; `spec/behavior/chapter-docs.md` § Google Drive
 * folder). For officers with Manage documents; hidden while this server has
 * no service account and nothing is connected.
 *
 * Comparable: Notion's, Slack's and Dropbox Sign's Google Drive connections:
 * sign in with Google, pick the folder in Google's own picker, then see its
 * last sync with a Sync now control. Where this server offers the picker
 * (#5583) that is the way in; otherwise the folder is shared by hand and
 * connected by its link.
 */
/**
 * Whether the Drive panel, and the Upload menu's item that opens it, show:
 * not while this server has no service account and nothing is connected.
 * One rule for both, so the item never opens a panel that draws nothing.
 */
export function driveFolderShown(
  data: GoogleDriveStatus | undefined,
): data is GoogleDriveStatus {
  return !!data && (data.available || !!data.connection);
}

/** The connected folder lost its sharing, so Drive needs the officer. */
export function driveNeedsAttention(
  data: GoogleDriveStatus | undefined,
): boolean {
  return data?.connection?.status === "no_access";
}

export function DriveFolderPanel({
  gate,
  documents = [],
  folders = [],
  openerRef,
}: {
  gate: SubscriptionGate;
  /** The documents the officer sees, for the copies sync is holding back. */
  documents?: readonly ChapterDocument[];
  /** The chapter's folders, to name where Drive put a held copy. */
  folders?: readonly FolderRow[];
  /**
   * Set, the panel draws no button of its own and puts its opener here, for
   * a menu to call: Documents opens it from the Upload menu (#5576).
   */
  openerRef?: RefObject<(() => void) | null>;
}) {
  const status = useGoogleDriveStatus();
  const dialog = useGatedDialog(gate);
  // The link flow stays one press away while the picker is new (#5583): an
  // officer whose network blocks Google's scripts can still connect.
  const [byLink, setByLink] = useState(false);
  useLayoutEffect(() => {
    if (openerRef) openerRef.current = () => dialog.setOpen(true);
  });
  const data = status.data;
  if (!driveFolderShown(data)) return null;
  const connected = data.connection;

  return (
    <>
      {openerRef ? null : (
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
      )}
      <Panel {...dialog.dialogProps} docked backLabel="Back to documents">
        <PanelContent {...dialog.contentProps} aria-describedby={undefined}>
          {connected ? (
            <ConnectedView
              status={data}
              gate={gate}
              held={heldCopies(documents, folders)}
              onClose={() => dialog.setOpen(false)}
            />
          ) : data.picker && !byLink ? (
            <PickerConnectView
              picker={data.picker}
              gate={gate}
              open={dialog.open}
              onCancel={() => dialog.setOpen(false)}
              onUseLink={() => setByLink(true)}
            />
          ) : (
            <ConnectView
              email={data.service_account_email}
              gate={gate}
              open={dialog.open}
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
  open,
  onCancel,
}: {
  email: string | null;
  gate: SubscriptionGate;
  open: boolean;
  onCancel: () => void;
}) {
  const connect = useConnectGoogleDrive();
  const access = useDocumentAccessChoices(open);
  const { toast } = useToast();
  const [link, setLink] = useState("");
  const [whoCanSee, setWhoCanSee] = useState<string[] | null>(null);
  const accessId = useId();
  const hideAccess = access.optionsState === "ready" && !access.canLimit;
  const accessReady = access.optionsState === "ready";
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !link.trim() ||
      connect.isPending ||
      !accessReady ||
      isEmptyChannelAccessChoice(whoCanSee)
    ) {
      return;
    }
    setError(null);
    try {
      await connect.mutateAsync({ folderLink: link.trim(), whoCanSee });
      toast({
        title: "Google Drive connected",
        description: "Its files will show up in Documents in a minute or two.",
      });
    } catch (caught) {
      // The API writes each refusal for the officer (not a folder link,
      // not shared with Frapp yet, a file instead of a folder, connected to
      // another chapter, or the code that shows the folder is this
      // chapter's, to add to its name in Drive: #5185).
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
          Every file in the folder shows up in Documents for the people you
          choose, and stays in sync as the folder changes. Google Docs and
          Slides come in as PDFs, and Sheets as Excel files.
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
            <p className="text-caption text-muted-foreground">
              The first time, Frapp gives you a short code to add to the
              folder&apos;s name in Drive, so it knows the folder is your
              chapter&apos;s. Then connect again.
            </p>
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
          {/*
            Left out only once the choices have loaded and say this member
            may not set a list (outside every tier); the folder then comes in
            open, as any folder they make does. While the choices load or
            fail the field shows that, and Connect waits, so a folder is never
            connected open because the picker didn't appear.
          */}
          {!hideAccess ? (
            <li className="space-y-2">
              <p className="text-body font-medium">3. Choose who sees it</p>
              <ChannelAccessField
                id={accessId}
                question="see"
                value={whoCanSee}
                onChange={setWhoCanSee}
                options={access.options}
                optionsState={access.optionsState}
                locked={access.locked}
                alwaysLine={FOLDER_ALWAYS_LINE}
                canChoose={access.canLimit}
                disabled={connect.isPending}
              />
              <p className="text-caption text-muted-foreground">
                Its subfolders start the same way. You can narrow any of them
                later from Edit folder.
              </p>
            </li>
          ) : null}
        </ol>
      </PanelBody>
      <PanelFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            !link.trim() ||
            connect.isPending ||
            !accessReady ||
            isEmptyChannelAccessChoice(whoCanSee) ||
            !gate.allowed
          }
          aria-busy={connect.isPending}
        >
          {connect.isPending ? "Connecting…" : "Connect"}
        </Button>
      </PanelFooter>
    </form>
  );
}

/**
 * Signs the officer in with Google and opens the picker; the error, worded
 * for them, or null when they closed it. Shared by connecting and by sharing
 * an unshared folder again.
 */
function usePickFolder(picker: DrivePickerConfig, active: boolean) {
  const [picking, setPicking] = useState(false);
  // Loaded as the panel opens, so the sign-in window opens straight from the
  // press: browsers block a popup opened long after it.
  useEffect(() => {
    if (active) void preloadDrivePicker().catch(() => undefined);
  }, [active]);
  async function pick(): Promise<
    { folder: PickedFolder } | { error: string } | null
  > {
    if (picking) return null;
    setPicking(true);
    try {
      const folder = await pickDriveFolder(picker);
      return folder ? { folder } : null;
    } catch (caught) {
      return {
        error:
          caught instanceof DrivePickerError
            ? caught.message
            : "Couldn't open Google's folder picker. Try again.",
      };
    } finally {
      setPicking(false);
    }
  }
  return { pick, picking };
}

/**
 * Connect by picking (#5583): the officer signs in with Google and picks the
 * folder in Google's own picker, and Frapp shares it with itself using that
 * sign-in. No address to copy, no link to paste, no code to add.
 */
function PickerConnectView({
  picker,
  gate,
  open,
  onCancel,
  onUseLink,
}: {
  picker: DrivePickerConfig;
  gate: SubscriptionGate;
  open: boolean;
  onCancel: () => void;
  onUseLink: () => void;
}) {
  const connect = useConnectPickedGoogleDrive();
  const access = useDocumentAccessChoices(open);
  const { toast } = useToast();
  const { pick, picking } = usePickFolder(picker, open);
  const [folder, setFolder] = useState<PickedFolder | null>(null);
  const [whoCanSee, setWhoCanSee] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accessId = useId();
  const errorId = useId();
  const hideAccess = access.optionsState === "ready" && !access.canLimit;
  const accessReady = access.optionsState === "ready";
  const blocked =
    !folder ||
    connect.isPending ||
    !accessReady ||
    isEmptyChannelAccessChoice(whoCanSee);

  async function choose() {
    setError(null);
    const result = await pick();
    if (!result) return;
    if ("error" in result) setError(result.error);
    else setFolder(result.folder);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (blocked || !folder) return;
    setError(null);
    try {
      await connect.mutateAsync({
        folderId: folder.id,
        accessToken: folder.accessToken,
        whoCanSee,
      });
      toast({
        title: `${folder.name || "Google Drive"} connected`,
        description: "Its files show up in Documents in a minute or two.",
      });
    } catch (caught) {
      // The API words each refusal for the officer: a folder they can only
      // view, a school account that blocks sharing out, a folder another
      // chapter has, or a sign-in that expired (pick again). The next pick
      // asks Google afresh, with the account chooser, from no folder.
      forgetDrivePickerSignIn();
      setFolder(null);
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
          Every file in the folder shows up in Documents and stays in sync with
          Drive. Google Docs and Slides come in as PDFs, and Sheets as Excel
          files.
        </p>
        <div className="space-y-2">
          <p className="text-body font-medium">Folder</p>
          <button
            type="button"
            onClick={() => void choose()}
            disabled={picking || connect.isPending}
            aria-busy={picking}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="flex w-full min-w-0 items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-left text-body transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <Folder
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span
              className={
                folder
                  ? "min-w-0 flex-1 truncate"
                  : "min-w-0 flex-1 truncate text-muted-foreground"
              }
            >
              {folder
                ? folder.name || "Untitled folder"
                : "Choose a folder in Google Drive"}
            </span>
            {picking ? (
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </button>
          {error ? (
            <p
              id={errorId}
              role="alert"
              className="text-caption text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>
        {/*
          Left out only once the choices have loaded and say this member may
          not set a list (outside every tier), as on the link flow.
        */}
        {!hideAccess ? (
          <div className="space-y-2">
            <p className="text-body font-medium">Who sees it</p>
            <ChannelAccessField
              id={accessId}
              question="see"
              value={whoCanSee}
              onChange={setWhoCanSee}
              options={access.options}
              optionsState={access.optionsState}
              locked={access.locked}
              alwaysLine={FOLDER_ALWAYS_LINE}
              canChoose={access.canLimit}
              disabled={connect.isPending}
            />
          </div>
        ) : null}
        <button
          type="button"
          onClick={onUseLink}
          className="text-caption text-muted-foreground underline-offset-4 hover:underline"
        >
          Use a folder link instead
        </button>
      </PanelBody>
      <PanelFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={blocked || !gate.allowed}
          aria-busy={connect.isPending}
        >
          {connect.isPending ? "Connecting…" : "Connect"}
        </Button>
      </PanelFooter>
    </form>
  );
}

/**
 * The connected folder was unshared (`no_access`): picking it again shares
 * it with Frapp again and syncs it at once (#5583).
 */
function ShareAgainButton({ picker }: { picker: DrivePickerConfig }) {
  const connect = useConnectPickedGoogleDrive();
  const { pick, picking } = usePickFolder(picker, true);
  const { toast } = useToast();
  async function shareAgain() {
    const result = await pick();
    if (!result) return;
    if ("error" in result) {
      toast({
        variant: "destructive",
        title: "Couldn't open Google Drive",
        description: result.error,
      });
      return;
    }
    try {
      await connect.mutateAsync({
        folderId: result.folder.id,
        accessToken: result.folder.accessToken,
        whoCanSee: null,
      });
      toast({ title: "Syncing again" });
    } catch (caught) {
      forgetDrivePickerSignIn();
      toast({
        variant: "destructive",
        title: "Couldn't share it again",
        description: getErrorMessage(caught, "Try again in a moment.", {
          serverWritesForMembers: true,
        }),
      });
    }
  }
  const busy = picking || connect.isPending;
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => void shareAgain()}
      disabled={busy}
      aria-busy={busy}
    >
      Pick it again
    </Button>
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
    <div className="flex items-center gap-2 rounded-md border border-border bg-card-hover px-3 py-2">
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
  held,
  onClose,
}: {
  status: GoogleDriveStatus;
  gate: SubscriptionGate;
  held: HeldCopy[];
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
            className="space-y-2 rounded-md border border-destructive/45 bg-destructive-tint p-3"
          >
            <p className="text-body font-medium">
              Frapp can&apos;t see this folder any more
            </p>
            <p className="text-caption text-muted-foreground">
              It was unshared or deleted. Its files stay in Documents as they
              were.
              {status.picker
                ? null
                : " Share it with Frapp again to keep syncing, or disconnect it."}
            </p>
            {status.picker ? (
              <ShareAgainButton picker={status.picker} />
            ) : status.service_account_email ? (
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
          {connection.folders_left_out > 0 ? (
            <>
              <dt className="text-muted-foreground">Not read</dt>
              <dd>
                {folderCount(connection.folders_left_out)}
                <span className="block text-caption text-muted-foreground">
                  These, and any folders inside them, are past Frapp&apos;s
                  limit of 10 levels or 300 folders, so their files aren&apos;t
                  in Documents. Move them higher up in Drive, or connect a
                  smaller folder.
                </span>
              </dd>
            </>
          ) : null}
        </dl>

        {held.length > 0 ? <HeldCopies held={held} gate={gate} /> : null}

        <p className="text-caption text-muted-foreground">
          Changes in the folder reach Documents within 15 minutes. Subfolders up
          to 10 levels down become folders here, named by their path, and keep
          who can see them when renamed in Drive. To rename, remove or delete
          anything, do it in Google Drive.
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

function folderCount(count: number): string {
  return count === 1 ? "1 folder" : `${count} folders`;
}

/** A copy sync left in place because Drive moved it somewhere wider (#5220). */
type HeldCopy = { doc: ChapterDocument; movedTo: string };

/**
 * The copies sync is holding back, each with the folder Drive put it in. A
 * copy whose folder the officer can't see comes back without one from the
 * API, so it isn't listed: it isn't theirs to open up.
 */
export function heldCopies(
  documents: readonly ChapterDocument[],
  folders: readonly FolderRow[],
): HeldCopy[] {
  const names = new Map(
    folders.flatMap((folder) =>
      folder.id ? [[folder.id, folder.name] as const] : [],
    ),
  );
  return documents.flatMap((doc) => {
    const movedTo = doc.drive_held_folder_id
      ? names.get(doc.drive_held_folder_id)
      : undefined;
    return movedTo ? [{ doc, movedTo }] : [];
  });
}

/**
 * "Held back": files Drive moved into a folder more people may see. Sync
 * never widens who sees a file by itself, so each stays where it was until
 * an officer opens it up, the way Drive itself asks before a move changes
 * who has access.
 */
function HeldCopies({
  held,
  gate,
}: {
  held: HeldCopy[];
  gate: SubscriptionGate;
}) {
  const openUp = useOpenUpDriveCopy();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onOpenUp({ doc, movedTo }: HeldCopy) {
    const ok = await confirm({
      title: `Move ${doc.title} to ${movedTo}?`,
      description: `Everyone who can see ${movedTo} will see it.`,
      confirmLabel: "Open it up",
    });
    if (!ok) return;
    setBusyId(doc.id);
    try {
      await openUp.mutateAsync(doc.id);
      toast({ title: `${doc.title} moved to ${movedTo}` });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't move it",
        description: getErrorMessage(error, "Try again in a moment."),
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-2" aria-labelledby="drive-held-heading">
      <h3 id="drive-held-heading" className="text-body font-medium">
        Held back
      </h3>
      <p className="text-caption text-muted-foreground">
        Someone moved these in Google Drive into a folder more people can see.
        They stay where they were until you open them up.
      </p>
      <ul className="divide-y divide-border">
        {held.map((copy) => (
          <li
            key={copy.doc.id}
            className="flex min-h-11 items-center gap-3 py-1.5"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body">{copy.doc.title}</span>
              <span className="block truncate text-caption text-muted-foreground">
                In {copy.doc.folder ?? "Documents"}, moved to {copy.movedTo} in
                Drive
              </span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onOpenUp(copy)}
              aria-busy={busyId === copy.doc.id}
              {...gate.controlProps(busyId !== null)}
            >
              Open it up
            </Button>
          </li>
        ))}
      </ul>
      {confirmDialog}
    </section>
  );
}
