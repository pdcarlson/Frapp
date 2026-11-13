/**
 * The Frapp desktop app's main process (ADR-29).
 *
 * A thin shell: one window showing the hosted web app, kept running in the
 * tray (Windows, Linux) or the dock (macOS) when the window is closed, so it
 * can notify like Discord and Slack do. Everything a member sees is the web
 * app; this file owns only the window, the menus and what may leave it.
 */
import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import path from "node:path";
import { resolveAppOrigin } from "../shared/app-url";
import { IPC, parseBadgeCount, parseExternalUrl } from "../shared/bridge";
import { decideNavigation, isPermissionAllowed } from "../shared/navigation";
import { offlinePageHtml, WINDOW_BACKGROUND } from "../shared/offline-page";
import { MIN_SIZE } from "../shared/window-state";
import { installContextMenu } from "./context-menu";
import { installAppMenu, launchedHidden } from "./menu";
import { createTray } from "./tray";
import { loadWindowState, trackWindowState } from "./window-state-store";

const { origin: appOrigin, rejected } = resolveAppOrigin({
  argv: process.argv,
  env: process.env,
  isPackaged: app.isPackaged,
});
if (rejected) console.warn(`Ignoring app URL outside the allow-list: ${rejected}`);

let mainWindow: BrowserWindow | null = null;
/** Set when the member chose Quit, so closing the window really quits. */
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  // A second launch (double-clicking the icon again) hands over to the first.
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.on("before-quit", () => {
    quitting = true;
  });
  // macOS: clicking the dock icon with no window open brings it back.
  app.on("activate", () => showWindow());
  // The window hides instead of closing, so this fires only on a real quit.
  app.on("window-all-closed", () => app.quit());

  // Every page, including ones the app opens later, gets the same rules.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      const decision = decideNavigation(url, appOrigin);
      if (decision.kind === "stay") return;
      event.preventDefault();
      if (decision.kind === "external") void shell.openExternal(decision.url);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      const decision = decideNavigation(url, appOrigin);
      if (decision.kind === "external") void shell.openExternal(decision.url);
      if (decision.kind === "stay") void contents.loadURL(url);
      return { action: "deny" };
    });
  });

  void app.whenReady().then(() => {
    installPermissionHandlers();
    installBridge();
    installAppMenu({ isPackaged: app.isPackaged, showWindow });
    if (process.platform !== "darwin") createTray({ showWindow, iconPath: trayIconPath() });
    mainWindow = createWindow({ hidden: launchedHidden() });
  });
}

function createWindow(options: { hidden?: boolean } = {}): BrowserWindow {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: "Frapp",
    backgroundColor: WINDOW_BACKGROUND,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
      additionalArguments: [`--frapp-desktop-version=${app.getVersion()}`],
    },
  });
  if (state.maximized) win.maximize();
  if (state.bounds.x === undefined) win.center();
  trackWindowState(win);
  installContextMenu(win.webContents);

  win.once("ready-to-show", () => {
    if (!options.hidden) win.show();
  });
  // Closing the window keeps Frapp running for notifications; Quit ends it.
  // Windows signing out or shutting down closes windows without `before-quit`;
  // hiding instead would hold up the shutdown.
  win.on("session-end", () => {
    quitting = true;
  });
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    // -3 is ERR_ABORTED: a navigation the page or we cancelled, not a failure.
    if (!isMainFrame || code === -3 || url.startsWith("data:")) return;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlinePageHtml(appOrigin))}`);
  });

  void win.loadURL(appOrigin);
  return win;
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function installPermissionHandlers(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    callback(isPermissionAllowed(permission, details.requestingUrl ?? contents.getURL(), appOrigin, mediaTypes));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin, appOrigin),
  );
}

/** The main-process half of `window.frappDesktop`; see `shared/bridge.ts`. */
function installBridge(): void {
  const fromApp = (event: Electron.IpcMainEvent): boolean =>
    event.senderFrame?.origin === appOrigin;

  ipcMain.on(IPC.setBadgeCount, (event, value: unknown) => {
    const count = parseBadgeCount(value);
    if (!fromApp(event) || count === null) return;
    // macOS and Linux draw this on the icon; the Windows overlay comes with #4842.
    app.setBadgeCount(count);
  });
  ipcMain.on(IPC.openExternal, (event, value: unknown) => {
    const url = parseExternalUrl(value);
    if (!fromApp(event) || url === null) return;
    void shell.openExternal(url);
  });
}

/** The Frapp mark for the tray: bundled as an extra resource when packaged. */
function trayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "tray.png")
    : path.join(__dirname, "../../../../packages/brand-assets/assets/signet-emblem-B-32.png");
}
