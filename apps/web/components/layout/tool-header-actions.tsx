"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PageActions } from "@/components/layout/page-actions";

/**
 * Where a tool page's own header keeps its actions, beside its X: set by the
 * shell while that header shows (the side-by-side width), null otherwise.
 */
export const ToolHeaderSlot = createContext<HTMLElement | null>(null);

/**
 * A tool page's one main action, such as New minutes, in the page's header
 * beside its X (Paul, 2026-11-19: "what if the new minutes button goes up to
 * the Minutes section header next to the x?"), the way Linear and Notion keep
 * a page's New button in its title bar rather than in a row of its own. Where
 * the header isn't shown (a narrow window, where the title is in the top
 * bar), or outside the shell, it stays in the page's action row.
 */
export function ToolHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(ToolHeaderSlot);
  if (slot) return createPortal(children, slot);
  return <PageActions>{children}</PageActions>;
}
