"use client";

import React, { createContext, useContext } from "react";

/**
 * "View as a role" (#4072): while an officer previews a role, the permission
 * set every screen reads in place of their own. `null` when no preview runs,
 * which is always the case on mobile: only the web dashboard provides one.
 *
 * It changes what {@link useMyPermissions} hands to screens, never the cached
 * query or the session. The API still answers as the officer; the web
 * client refuses writes while a preview runs (`frapp-client-provider.tsx`).
 */
const PermissionPreviewContext = createContext<readonly string[] | null>(null);

export function PermissionPreviewProvider({
  permissions,
  children,
}: {
  permissions: readonly string[] | null;
  children: React.ReactNode;
}) {
  return (
    <PermissionPreviewContext.Provider value={permissions}>
      {children}
    </PermissionPreviewContext.Provider>
  );
}

/** The previewed permission set, or `null` when the viewer is themselves. */
export function usePermissionPreview(): readonly string[] | null {
  return useContext(PermissionPreviewContext);
}
