"use client";

import { aiAvailableFrom, useAiConsent } from "@repo/hooks";
import { isBetaOffModule } from "@repo/validation";
import { useCallback } from "react";

/**
 * Whether a permission's switch is left off the role and tier pages because
 * the feature it opens is not offered here: the AI permissions until this
 * server says it has AI, and the Meetings ones while the module is held off
 * for the beta. The server's own catalog leaves the AI ones out the same way
 * (`RbacService.getPermissionsCatalog`); these pages draw from the shared
 * registry, so they need the same answer. An officer can't use a switch for
 * something nobody can open, and seeing one reads as a feature that exists.
 */
export function useIsPermissionHidden(): (permission: string) => boolean {
  const aiAvailable = aiAvailableFrom(useAiConsent());
  return useCallback(
    (permission: string) =>
      (permission.startsWith("ai:") && aiAvailable !== true) ||
      (permission.startsWith("meetings:") && isBetaOffModule("meetings")),
    [aiAvailable],
  );
}
