"use client";

import { isBetaOffModule } from "@repo/validation";
import { useCallback } from "react";
import { aiAvailableFrom, useAiConsent } from "./use-ai";

/**
 * Whether a permission's switch is left off the role and tier screens
 * because the feature it opens is not offered here: the AI permissions until
 * this server says it has AI (`aiAvailable` is `true`), and the Meetings ones
 * while the module is held off for the beta. The server's own catalog leaves
 * the AI ones out the same way (`RbacService.getPermissionsCatalog`); the
 * screens draw from the shared registry, so they need the same answer. An
 * officer can't use a switch for something nobody can open, and seeing one
 * reads as a feature that exists.
 *
 * One rule for web and the phone (#4504): each used to keep its own copy.
 */
export function isPermissionHidden(
  permission: string,
  aiAvailable: boolean | undefined,
): boolean {
  return (
    (permission.startsWith("ai:") && aiAvailable !== true) ||
    (permission.startsWith("meetings:") && isBetaOffModule("meetings"))
  );
}

/** {@link isPermissionHidden}, with whether this server has AI read for you. */
export function useIsPermissionHidden(): (permission: string) => boolean {
  const aiAvailable = aiAvailableFrom(useAiConsent());
  return useCallback(
    (permission: string) => isPermissionHidden(permission, aiAvailable),
    [aiAvailable],
  );
}
