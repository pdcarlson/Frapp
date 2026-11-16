"use client";

import { useCallback, useState } from "react";
import { useFetchBackworkResource } from "@repo/hooks";
import { openBackworkFile } from "@/components/backwork/backwork-download";
import { toastFailure } from "@/lib/failure-toast";

/**
 * Downloads a backwork file Frapp found (#5209). The answer never carries a
 * link: a tap asks `GET /v1/backwork/:id` for a fresh signed one, as the
 * library's own Download does (`openBackworkFile`), so the member's access
 * is checked again at that moment and nothing stale is ever opened.
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
        await openBackworkFile(fetchResource, backworkId);
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
