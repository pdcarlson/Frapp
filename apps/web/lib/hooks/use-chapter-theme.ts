"use client";

import { useEffect } from "react";
import { useCurrentChapter } from "@repo/hooks";
// The `/accent-vars` subpath, not the package root: the root barrel pulls in
// the accent generator and `colorjs.io`, which are server-side concerns
// (accent-engine.md §1) and have no business in a browser bundle that only
// re-keys an already-generated palette.
import {
  signetAccentSemanticVars,
  type SignetPalette,
} from "@repo/chapter-theme/accent-vars";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * Applies the active chapter's accent to the shell.
 *
 * This used to iterate every key of `chapters.theme_palette` onto `:root`,
 * which is how the legacy bone-validated `--ring` inline-overrode the `.dark`
 * stylesheet values (#1149) and why the sidebar's branded surface fought its
 * own text ladder (#1150/#1164). Since the #920 shell cutover it is a
 * deliberate mapping instead — the stored map is data, not a stylesheet:
 *
 *  - The persisted `--signet-accent-*` roles are remapped onto the semantic
 *    names the Signet stylesheet defines (`--primary`, `--ring`,
 *    `--accent-subtle`, …) via `signetAccentSemanticVars`. Contrast is
 *    guaranteed by the engine at generation time
 *    (`spec/ui/design-system/accent-engine.md` §8) — there is no per-token
 *    client-side fallback to run.
 *  - A row persisted before the Signet map existed simply lacks those keys;
 *    the house-gold defaults baked into `signet.css` stand until a save or
 *    recompute refreshes the row (accent-engine.md §3, staleness tracked in
 *    #1165). Nothing here assumes the keys exist.
 *  - **No legacy token is applied at all.** `derivePalette`'s map is written
 *    for the bone surface — `--mention-bg` is the accent at 12% *over bone*,
 *    `--chat-self-bubble` at 8% over bone, `--reaction-active` is validated
 *    against bone — so carrying any of them onto a `#0E0D0B` surface paints a
 *    near-white fill on the dark feed. The chat renderers that read those
 *    three now take `--accent-subtle` / the accent badge recipe instead, and
 *    the tokens stop here. That is also why `--ring` is the engine's: nothing
 *    bone-validated writes to this element any more (#1149).
 *
 * Mounted once by `DashboardShell`, so branding applies shell-wide (it used
 * to mount under the chat route only, which repainted the sidebar depending
 * on where you stood).
 */

/** The engine roles `signetAccentSemanticVars` reads; all-or-nothing. */
const SIGNET_ROLE_KEYS = [
  "--signet-accent-primary",
  "--signet-accent-hover",
  "--signet-accent-ring",
  "--signet-accent-subtle-bg",
  "--signet-accent-border",
  "--signet-accent-text",
  "--signet-accent-on-primary",
] as const;

export function useChapterTheme() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data } = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    const raw = data as Record<string, unknown> | undefined;
    const palette = raw?.["theme_palette"] as
      | Record<string, string>
      | undefined;
    if (!palette || Object.keys(palette).length === 0) return;

    const applied: string[] = [];
    const apply = (token: string, value: string) => {
      root.style.setProperty(token, value);
      applied.push(token);
    };

    if (SIGNET_ROLE_KEYS.every((key) => typeof palette[key] === "string")) {
      for (const [token, value] of Object.entries(
        signetAccentSemanticVars(palette as unknown as SignetPalette),
      )) {
        apply(token, value);
      }
    }

    return () => {
      // Remove chapter-specific overrides when the chapter changes or unmounts
      for (const token of applied) {
        root.style.removeProperty(token);
      }
    };
  }, [data, activeChapterId]);
}
