/**
 * Exposes `window.frappDesktop` to the web app and nothing else (ADR-29
 * decision 4). Runs sandboxed, so it can reach only `contextBridge` and
 * `ipcRenderer`, and it can't load other files of this app: the channel names
 * are written out here, and `bridge.spec.ts` checks they match `IPC` in
 * `shared/bridge.ts`. The main process re-checks every argument and the
 * sender's origin.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { FrappDesktopBridge } from "../shared/bridge";

const VERSION_ARG = "--frapp-desktop-version=";
const versionArg = process.argv.find((arg) => arg.startsWith(VERSION_ARG));

const bridge: FrappDesktopBridge = {
  version: versionArg ? versionArg.slice(VERSION_ARG.length) : "",
  platform: process.platform as FrappDesktopBridge["platform"],
  setBadgeCount: (count) => ipcRenderer.send("frapp-desktop:set-badge-count", count),
  openExternal: (url) => ipcRenderer.send("frapp-desktop:open-external", url),
};

contextBridge.exposeInMainWorld("frappDesktop", bridge);
