"use client";

import { useMyPermissions } from "@repo/hooks";
import { readIsOffline } from "@/components/shared/async-states";
import { useNetwork } from "@/lib/providers/network-provider";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * The viewer's permissions as the nav's doors read them (`isNavItemVisible`,
 * `hasSettingsDestination`), with "not known yet" split in two (#3854):
 *
 * - `undefined` while the read is in flight, or after it failed online: gated
 *   rows stay hidden, so a member never sees an officer's door drawn and taken
 *   back. `<Can>` hides on an online failure too.
 * - `null` when the read cannot be answered because the dashboard is offline
 *   with nothing cached (paused, or failing while `useNetwork()` says OFFLINE):
 *   gated rows show, the way the module gate does. An unresolved permission is
 *   not a held one, but neither is it a denial (`spec/ui/design-system/README.md`
 *   §5 rule 4), so a member keeps the Directory and Backwork rows they hold, and
 *   each destination states the outage itself.
 *
 * Once the shell has an answer the query stays mounted for the session, so
 * going offline later keeps the answer and changes nothing here.
 */
export function useNavPermissions(): readonly string[] | null | undefined {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const read = useMyPermissions({ enabled: Boolean(activeChapterId) });
  const { isOffline } = useNetwork();
  const permissions = read.data?.permissions;
  if (permissions) return permissions;
  if (activeChapterId && readIsOffline(isOffline, read)) return null;
  return undefined;
}
