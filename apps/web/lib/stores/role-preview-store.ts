import { create } from "zustand";

/**
 * "View as a role" (#4072): the role an officer is previewing the dashboard
 * as, or `null`. Kept in memory only, so a reload or a new tab is always the
 * officer's own view, and a preview can never outlive the tab that started it.
 */
export type RolePreview = {
  /** The chapter the preview belongs to; another chapter ends it. */
  chapterId: string;
  roleId: string;
  roleName: string;
  /** What a member holding only this role ends up with. */
  permissions: readonly string[];
  /** Where Exit goes back to: the role's page the preview started from. */
  returnTo: string;
};

interface RolePreviewState {
  preview: RolePreview | null;
  start: (preview: RolePreview) => void;
  stop: () => void;
}

export const useRolePreviewStore = create<RolePreviewState>()((set) => ({
  preview: null,
  start: (preview) => set({ preview }),
  stop: () => set({ preview: null }),
}));

/** The preview for the active chapter, or `null`. */
export function activePreview(
  preview: RolePreview | null,
  activeChapterId: string | null,
): RolePreview | null {
  return preview && preview.chapterId === activeChapterId ? preview : null;
}

/**
 * Writes a preview still lets through: the bookkeeping the app does on its
 * own while the officer reads (marking a channel or the activity feed read,
 * registering this browser for pushes, the What's new marker). They change
 * nothing anyone else sees, and refusing them would only leave unread badges
 * stuck and errors in the console. Anything else is something the officer
 * did, and a preview is for looking.
 */
const BOOKKEEPING_WRITES = [
  /\/v1\/channels\/[^/]+\/read$/,
  /\/v1\/activity\/(reads|unread-since)$/,
  /\/v1\/notifications\/(read|[^/]+\/read)$/,
  /\/v1\/push-tokens(\/[^/]+)?$/,
  /\/v1\/users\/me\/whats-new$/,
];

export function isPreviewBlockedWrite(method: string, url: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  return !BOOKKEEPING_WRITES.some((pattern) => pattern.test(path));
}

/** The code the refusal carries; `@repo/validation` maps it to a sentence. */
export const ROLE_PREVIEW_REFUSAL_CODE = "client.role_preview";
