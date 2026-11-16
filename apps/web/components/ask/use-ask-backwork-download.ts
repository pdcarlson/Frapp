"use client";

import { useCallback, useState } from "react";
import { selectDownloadUrl, useFetchBackworkResource } from "@repo/hooks";
import { toastFailure } from "@/lib/failure-toast";

/**
 * Downloads a backwork file Frapp found (#5209). The answer never carries a
 * link: a tap asks `GET /v1/backwork/:id` for a fresh signed one, as the
 * library's own Download does (`backwork-page.tsx`), so the member's access
 * is checked again at that moment and nothing stale is ever opened.
 *
 * A new tab, like the library: the link forces a download, but a storage
 * error answers with a page of its own, which would otherwise replace Ask.
 */
export function useAskBackworkDownload(): {
  download: (backworkId: string) => Promise<void>;
  /** The file whose link is being fetched, for a quiet pending state. */
  pendingId: string | null;
} {
  const fetchResource = useFetchBackworkResource();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const download = useCallback(
    async (backworkId: string) => {
      setPendingId(backworkId);
      try {
        const url = selectDownloadUrl(await fetchResource(backworkId));
        if (!url) throw new Error("No download link came back.");
        window.open(url, "_blank", "noopener");
      } catch (error) {
        toastFailure({
          title: "Couldn't download that file",
          error,
          fallback: "It may have been removed. Try again in a moment.",
        });
      } finally {
        setPendingId(null);
      }
    },
    [fetchResource],
  );
  return { download, pendingId };
}
