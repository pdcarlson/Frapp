"use client";

import { useState } from "react";
import {
  selectDownloadUrl,
  selectForcedDownloadUrl,
  useDocumentDownloadUrl,
} from "@repo/hooks";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/**
 * Saves a chapter document, for the row's Download icon and the viewer's.
 *
 * Each press asks `GET /v1/documents/{id}` for freshly signed links, because
 * they expire after an hour. It follows `forcedDownloadUrl`, which carries
 * `Content-Disposition: attachment`, so the browser saves the file and the
 * page stays where it is. A server from before #3849 sends only the inline
 * `downloadUrl`, which opens in a new tab as Download used to.
 *
 * Deliberately ungated: `enforceSubscription` returns early for GET, so a
 * lapsed chapter can still read everything it owns (§5 "writes only").
 */
export function useDocumentDownload() {
  const { toast } = useToast();
  const signedLinks = useDocumentDownloadUrl();
  const [fetchingId, setFetchingId] = useState<string | null>(null);

  async function download(id: string) {
    setFetchingId(id);
    try {
      const data = await signedLinks.mutateAsync(id);
      const forced = selectForcedDownloadUrl(data);
      if (forced) {
        window.location.assign(forced);
        return;
      }
      const inline = selectDownloadUrl(data);
      if (!inline) throw new Error("No download URL returned.");
      window.open(inline, "_blank", "noopener");
    } catch (error) {
      toast({
        title: "Couldn't fetch download link",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    } finally {
      setFetchingId(null);
    }
  }

  return { download, fetchingId };
}
