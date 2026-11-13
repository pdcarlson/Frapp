"use client";

import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

const subscribe = (onStoreChange: () => void) =>
  onlineManager.subscribe(() => onStoreChange());
const getOnline = () => onlineManager.isOnline();
const getServerOnline = () => true;

/**
 * Whether TanStack Query thinks the app is online, as each app wires its
 * `onlineManager` (web: the window's online/offline events; the phone: the
 * connection monitor, `apps/mobile/lib/connection/query-connectivity.ts`).
 * Used where a surface must tell "offline" from a read that is only slow,
 * failing, or paused for focus (the form page's open-time read, #4752).
 */
export function useQueryOnline(): boolean {
  return useSyncExternalStore(subscribe, getOnline, getServerOnline);
}
