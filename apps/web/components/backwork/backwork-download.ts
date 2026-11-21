import { selectDownloadUrl } from "@repo/hooks";

/**
 * Downloads one backwork file: a fresh signed link from `GET /v1/backwork/:id`
 * (`useFetchBackworkResource`), opened in a new tab. The library's Download
 * and a file Frapp AI found (#5209) both go through here.
 *
 * A new tab, not this one: the link forces a download (#3867), but a server
 * from before it signs an inline link, and a storage error answers with a
 * page of its own. Either would replace the page the member is on.
 *
 * Throws when no link comes back, for the caller's own failure toast.
 */
export async function openBackworkFile(
  fetchResource: (id: string) => Promise<unknown>,
  id: string,
): Promise<void> {
  const url = selectDownloadUrl(await fetchResource(id));
  if (!url) throw new Error("No download URL returned.");
  window.open(url, "_blank", "noopener");
}
