import { useSyncExternalStore } from "react";

/**
 * Whether this browser dismissed the phone dashboard's Get the app card
 * (#4002). Per browser, like What's new's marker (`lib/whats-new.ts`): the card
 * is about this phone, so dismissing it on one phone says nothing about
 * another, and a member who installs the app stops using this browser anyway.
 */
export const GET_THE_APP_DISMISSED_STORAGE_KEY =
  "frapp.web.get-the-app-dismissed";

const listeners = new Set<() => void>();
/** Set once dismissed in this page, so blocked storage still hides it until reload. */
let dismissedHere = false;

function readDismissed(): boolean {
  if (dismissedHere) return true;
  try {
    return (
      window.localStorage.getItem(GET_THE_APP_DISMISSED_STORAGE_KEY) === "1"
    );
  } catch {
    // Storage is blocked: the card comes back on the next page load, which is
    // the smaller failure than never offering it.
    return false;
  }
}

export function dismissGetTheApp(): void {
  dismissedHere = true;
  try {
    window.localStorage.setItem(GET_THE_APP_DISMISSED_STORAGE_KEY, "1");
  } catch {
    // Hidden for this page load only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True on the server and through hydration, so the card never flashes in. */
export function useGetTheAppDismissed(): boolean {
  return useSyncExternalStore(subscribe, readDismissed, () => true);
}

/** Test seam: a fresh page load. */
export function resetGetTheAppForTests(): void {
  dismissedHere = false;
  listeners.clear();
}
