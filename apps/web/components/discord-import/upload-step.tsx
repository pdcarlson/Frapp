"use client";

import { useCallback, useState } from "react";
import {
  meterFillClassName,
  meterTrackClassName,
} from "@/components/shared/meter";
import { Label } from "@/components/ui/label";
import {
  PREAMBLE_READ_BYTES,
  isMediaFile,
  parseExportPreamble,
  toExportRelativePath,
} from "./export-preamble";

/** How many PUTs run at once. Enough to saturate a link, few enough to watch. */
const UPLOAD_CONCURRENCY = 4;

/** The API caps a mint request at 100; stay under it. */
const MINT_BATCH = 100;

export interface StagedChannel {
  channelId: string;
  channelName: string;
  category: string | null;
}

export interface StagedRole {
  roleId: string;
  roleName: string;
}

export interface StagedExport {
  guildName: string | null;
  channels: StagedChannel[];
  roles: StagedRole[];
  exportCount: number;
  mediaCount: number;
  pendingUploads: number;
}

type Mutation<TVars, TData> = {
  mutateAsync: (vars: TVars) => Promise<TData>;
  isPending: boolean;
};

/**
 * Folder picker, header scan, and direct-to-storage upload.
 *
 * The bytes never touch the API: the browser asks for a signed URL per file and
 * PUTs to storage itself. That is what makes a multi-gigabyte archive possible
 * at all against an API instance sized in hundreds of megabytes.
 */
export function UploadStep({
  importId,
  requestUrls,
  confirmUploads,
  onStaged,
}: {
  importId: string;
  requestUrls: Mutation<
    {
      id: string;
      files: {
        kind: "export" | "media";
        relative_path: string;
        content_type: string;
        byte_size: number;
        part_index?: number;
      }[];
    },
    { relative_path: string; storage_path: string; upload_url: string }[]
  >;
  confirmUploads: Mutation<{ id: string; storage_paths: string[] }, unknown>;
  onStaged: (staged: StagedExport) => void;
}) {
  const [status, setStatus] = useState<
    "idle" | "reading" | "uploading" | "done"
  >("idle");
  const [uploaded, setUploaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);

      setStatus("reading");
      setFailures([]);
      setUploaded(0);

      const channels = new Map<string, StagedChannel>();
      let guildName: string | null = null;
      let partIndex = 0;

      const staged: {
        file: File;
        kind: "export" | "media";
        relativePath: string;
        partIndex?: number;
      }[] = [];

      for (const file of files) {
        const relativePath = toExportRelativePath(
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
            file.name,
        );

        if (
          file.name.toLowerCase().endsWith(".json") &&
          !isMediaFile(relativePath)
        ) {
          // Only the header is read — a partition can be megabytes and there can
          // be hundreds of them.
          const head = await file.slice(0, PREAMBLE_READ_BYTES).text();
          const preamble = parseExportPreamble(head);
          if (preamble) {
            guildName = guildName ?? preamble.guildName;
            if (!channels.has(preamble.channelId)) {
              channels.set(preamble.channelId, {
                channelId: preamble.channelId,
                channelName: preamble.channelName,
                category: preamble.category,
              });
            }
          }
          staged.push({
            file,
            kind: "export",
            relativePath,
            partIndex: partIndex++,
          });
          continue;
        }

        staged.push({ file, kind: "media", relativePath });
      }

      setTotal(staged.length);
      setStatus("uploading");

      const landed: string[] = [];
      const failed: string[] = [];

      for (let i = 0; i < staged.length; i += MINT_BATCH) {
        const batch = staged.slice(i, i + MINT_BATCH);
        let tickets;
        try {
          tickets = await requestUrls.mutateAsync({
            id: importId,
            files: batch.map((entry) => ({
              kind: entry.kind,
              relative_path: entry.relativePath,
              content_type: entry.file.type || "application/octet-stream",
              byte_size: entry.file.size,
              part_index: entry.partIndex,
            })),
          });
        } catch {
          failed.push(...batch.map((entry) => entry.relativePath));
          setFailures((prev) => [
            ...prev,
            ...batch.map((entry) => entry.relativePath),
          ]);
          setUploaded((prev) => prev + batch.length);
          continue;
        }

        const byRelativePath = new Map(
          tickets.map((ticket) => [ticket.relative_path, ticket]),
        );

        // A bounded worker pool rather than Promise.all over the whole batch:
        // 100 concurrent PUTs of archive media will stall a browser's
        // connection pool and make the meter lie about what is in flight.
        let cursor = 0;
        await Promise.all(
          Array.from({ length: UPLOAD_CONCURRENCY }, async () => {
            for (;;) {
              const index = cursor++;
              if (index >= batch.length) return;
              const entry = batch[index];
              if (!entry) return;
              const ticket = byRelativePath.get(entry.relativePath);
              if (!ticket) {
                failed.push(entry.relativePath);
                setFailures((prev) => [...prev, entry.relativePath]);
                setUploaded((prev) => prev + 1);
                continue;
              }
              try {
                const response = await fetch(ticket.upload_url, {
                  method: "PUT",
                  body: entry.file,
                  headers: {
                    "content-type":
                      entry.file.type || "application/octet-stream",
                    "x-upsert": "true",
                  },
                });
                if (!response.ok) throw new Error(String(response.status));
                landed.push(ticket.storage_path);
              } catch {
                failed.push(entry.relativePath);
                setFailures((prev) => [...prev, entry.relativePath]);
              } finally {
                setUploaded((prev) => prev + 1);
              }
            }
          }),
        );
      }

      if (landed.length > 0) {
        await confirmUploads.mutateAsync({
          id: importId,
          storage_paths: landed,
        });
      }

      setStatus("done");
      onStaged({
        guildName,
        channels: [...channels.values()].sort((a, b) =>
          a.channelName.localeCompare(b.channelName),
        ),
        // Roles are discovered server-side while parsing, so the wizard offers
        // the mapping grid against what the export's authors actually carry.
        // Until the scan runs there is nothing to show, and an empty grid is
        // honest — the default is Member regardless.
        roles: [],
        exportCount: staged.filter((entry) => entry.kind === "export").length,
        mediaCount: staged.filter((entry) => entry.kind === "media").length,
        pendingUploads: failed.length,
      });
    },
    [confirmUploads, importId, onStaged, requestUrls],
  );

  const percent = total === 0 ? 0 : Math.round((uploaded / total) * 100);

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          Export your server with DiscordChatExporter, then pick the export
          folder below. Signet uploads the files straight from your browser.
        </p>
        <pre className="overflow-x-auto rounded-md border border-border bg-surface-1 p-3 text-xs">
          <code>
            DiscordChatExporter.Cli exportguild -t &lt;token&gt; -g &lt;server
            id&gt; -f Json --media --utc --partition 8mb -o export/
          </code>
        </pre>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="discord-export-folder">Export folder</Label>
        <input
          id="discord-export-folder"
          type="file"
          multiple
          // Non-standard but universally supported; the React types do not
          // declare it, hence the cast.
          {...({ webkitdirectory: "" } as Record<string, string>)}
          onChange={(event) => void handleFiles(event.target.files)}
          disabled={status === "reading" || status === "uploading"}
          className="text-sm"
        />
      </div>

      {status !== "idle" ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span>
              {status === "reading"
                ? "Reading the export…"
                : status === "uploading"
                  ? "Uploading"
                  : "Upload complete"}
            </span>
            {/* The bar is aria-hidden, so this text is the accessible signal —
                not a redundant caption. */}
            <span className="text-muted-foreground">
              {uploaded} of {total} files · {percent}%
            </span>
          </div>
          <div aria-hidden="true" className={meterTrackClassName}>
            <div
              className={meterFillClassName}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : null}

      {failures.length > 0 ? (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-semibold text-destructive-text">
            {failures.length} file(s) did not upload
          </p>
          <p className="mt-1 text-muted-foreground">
            Pick the folder again to retry — Signet re-sends only what is
            missing. Files over 100 MB cannot be imported.
          </p>
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
            {failures.slice(0, 20).map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {status === "done" && failures.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Uploaded. Next, decide where each Discord channel should land.
        </p>
      ) : null}
    </div>
  );
}
