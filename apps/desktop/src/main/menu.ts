import { app, Menu, type MenuItemConstructorOptions } from "electron";

/**
 * The application menu. macOS needs one for Copy, Paste and Undo to work at
 * all; on Windows and Linux the bar stays hidden (Alt shows it) and its
 * shortcuts still apply. Developer tools appear only in an unpackaged
 * `npm run dev`.
 */
export function installAppMenu(options: { isPackaged: boolean; showWindow: () => void }): void {
  const isMac = process.platform === "darwin";
  const view: MenuItemConstructorOptions[] = [
    { role: "reload" },
    ...(options.isPackaged ? [] : [{ role: "toggleDevTools" } as const]),
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              openAtLoginItem(),
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : [{ label: "&File", submenu: [openAtLoginItem(), { type: "separator" }, { role: "quit" }] } satisfies MenuItemConstructorOptions]),
    { role: "editMenu" },
    { label: "&View", submenu: view },
    {
      role: "windowMenu",
      submenu: [
        { role: "minimize" },
        ...(isMac ? [{ role: "zoom" } as const] : []),
        { label: "Show Frapp", click: () => options.showWindow() },
        ...(isMac ? [{ type: "separator" } as const, { role: "front" } as const] : [{ role: "close" } as const]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const HIDDEN_FLAG = "--hidden";

/**
 * Whether this launch came from "Open at Login": Windows passes the flag we
 * registered, macOS reports it.
 */
export function launchedHidden(): boolean {
  if (process.argv.includes(HIDDEN_FLAG)) return true;
  return process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin === true;
}

/**
 * "Open at Login": off until the member turns it on, like Slack. It opens
 * hidden, in the tray or dock, so signing in to the computer doesn't throw a
 * window in their face (`launchedHidden`). `onChange` lets the tray redraw
 * its own copy.
 */
export function openAtLoginItem(onChange?: () => void): MenuItemConstructorOptions {
  return {
    label: process.platform === "darwin" ? "Open at Login" : "Start Frapp when you sign in",
    type: "checkbox",
    checked: app.getLoginItemSettings().openAtLogin,
    click: (item) => {
      app.setLoginItemSettings({ openAtLogin: item.checked, args: [HIDDEN_FLAG] });
      onChange?.();
    },
  };
}
