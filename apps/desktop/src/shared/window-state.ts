/**
 * Remembering the window's size and place between launches, and never
 * reopening it somewhere the member can't see (an unplugged monitor, a
 * smaller laptop screen).
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type WindowState = { bounds: Rect; maximized: boolean };

export const MIN_SIZE = { width: 480, height: 560 } as const;
export const DEFAULT_SIZE = { width: 1280, height: 820 } as const;

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every(
    (key) => typeof r[key] === "number" && Number.isFinite(r[key] as number),
  );
}

/** A saved state read back from disk, or `null` when it is missing or damaged. */
export function parseWindowState(raw: string | null): WindowState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!isRect(value.bounds)) return null;
    return { bounds: value.bounds, maximized: value.maximized === true };
  } catch {
    return null;
  }
}

/**
 * The bounds to open with. A saved window keeps its place only when at least
 * a 100 by 50 pixel corner of its title bar area is on a display that is still
 * attached; otherwise it opens at the default size, centred by the caller.
 */
export function restoreBounds(
  saved: WindowState | null,
  displays: readonly Rect[],
): Partial<Rect> & { width: number; height: number } {
  if (!saved) return { ...DEFAULT_SIZE };
  const width = Math.max(MIN_SIZE.width, Math.round(saved.bounds.width));
  const height = Math.max(MIN_SIZE.height, Math.round(saved.bounds.height));
  const { x, y } = saved.bounds;
  const titleBar: Rect = { x, y, width: Math.min(width, 100), height: 50 };
  const visible = displays.some((d) => overlap(titleBar, d) >= titleBar.width * titleBar.height);
  return visible ? { x: Math.round(x), y: Math.round(y), width, height } : { width, height };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
