import { aiAvailableFrom, useAiConsent } from "@repo/hooks";
import { isBetaOffModule } from "@repo/validation";
import { useCallback } from "react";

/**
 * Whether a permission's switch is left off the tier and role screens because
 * the feature it opens is not offered here: the AI permissions until this
 * server says it has AI, and the Meetings ones while the module is held off
 * for the beta. Web's `components/roles/hidden-permissions.ts` gives the same
 * answer, and the server's catalog leaves the AI ones out the same way.
 */
export function useIsPermissionHidden(): (permission: string) => boolean {
  const available = aiAvailableFrom(useAiConsent());
  return useCallback(
    (permission: string) =>
      (permission.startsWith("ai:") && available !== true) ||
      (permission.startsWith("meetings:") && isBetaOffModule("meetings")),
    [available],
  );
}
