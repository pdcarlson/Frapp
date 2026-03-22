import type { Href } from "expo-router";

/**
 * Typed-route generation does not always include every file-based path in this app.
 * Use for static in-app paths that are valid at runtime.
 */
export function asRoute(path: string): Href {
  return path as Href;
}
