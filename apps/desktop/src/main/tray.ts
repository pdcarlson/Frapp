import { Menu, nativeImage, Tray } from "electron";
import { openAtLoginItem } from "./menu";

/**
 * The tray icon on Windows and Linux, where a closed window keeps running
 * there (macOS keeps it in the dock instead). Clicking it opens the window.
 */
export function createTray(options: { showWindow: () => void; iconPath: string }): Tray {
  const icon = nativeImage.createFromPath(options.iconPath).resize({ width: 16, height: 16 });
  const tray = new Tray(icon);
  tray.setToolTip("Frapp");
  const rebuild = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Frapp", click: () => options.showWindow() },
        { type: "separator" },
        openAtLoginItem(rebuild),
        { type: "separator" },
        { role: "quit", label: "Quit Frapp" },
      ]),
    );
  };
  rebuild();
  tray.on("click", () => options.showWindow());
  return tray;
}
