import { app, screen, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { parseWindowState, restoreBounds, type WindowState } from "../shared/window-state";

const stateFile = (): string => path.join(app.getPath("userData"), "window-state.json");

export function loadWindowState(): {
  bounds: ReturnType<typeof restoreBounds>;
  maximized: boolean;
} {
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(stateFile(), "utf8");
  } catch {
    // First launch, or the file was removed: open at the default size.
  }
  const saved = parseWindowState(raw);
  const displays = screen.getAllDisplays().map((display) => display.workArea);
  return { bounds: restoreBounds(saved, displays), maximized: saved?.maximized ?? false };
}

/** Saves the window's place a moment after it stops moving, and on close. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
      fs.writeFileSync(stateFile(), JSON.stringify(state));
    } catch {
      // Not worth interrupting anyone over: the next launch uses the default size.
    }
  };
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on("resize", later);
  win.on("move", later);
  win.on("close", save);
}
