"use client";

import { AppNav } from "@/components/layout/app-nav";
import { ChapterNavHeader } from "@/components/layout/chapter-nav-header";
import { useNavHighlights } from "@/components/layout/use-chat-has-unread";
import { VoiceBar } from "@/components/voice/voice-ui";
import { cn } from "@/lib/utils";

/**
 * The desktop shell's left column, on every route from `lg` up: the chapter
 * band and the module nav (`spec/ui/design-system/components.md` § 7).
 *
 * It always stays (#3779). Chat is no longer a face of this column: it is a
 * panel of its own right of the column, which the Chat row opens and closes
 * (`dashboard-shell.tsx`). The column never changes contents between routes,
 * so nothing in it moves going in and out of Chat (Paul, 2026-11-06).
 *
 * The chapter switcher sits in a 48px band that lines up with the top bar and
 * the column headers beside it. 240px expanded, 56px as a rail: the rail is
 * the member's preference, or forced while chat and a tool share a window too
 * narrow for the full nav (`shell-layout.ts`).
 */

type NavColumnProps = {
  /** Rail: the preference, or forced by the shell. */
  collapsed: boolean;
  /** The preference toggle; absent while the shell forces the rail. */
  onToggleCollapsed?: () => void;
  permissions: readonly string[] | null | undefined;
  isModuleEnabled?: (moduleKey: string) => boolean;
  pathname: string;
  /** The Chat row as a toggle, from the side-by-side width up. */
  chatRow?: { onSelect: () => void; open: boolean };
  /** Closes the open tool, from the side-by-side width up. */
  onCloseTool?: () => void;
  /** Extra classes on the column, merged last (the shell's band visibility). */
  className?: string;
};

export function NavColumn({
  collapsed,
  onToggleCollapsed,
  permissions,
  isModuleEnabled,
  pathname,
  chatRow,
  onCloseTool,
  className,
}: NavColumnProps) {
  const highlighted = useNavHighlights();

  return (
    <div
      data-nav-column=""
      className={cn(
        "box-border flex h-full shrink-0 flex-col border-r border-border bg-surface-1",
        collapsed ? "w-14" : "w-60",
        className,
      )}
    >
      {/*
        Not a centering flex box in the rail: the chapter row fills the band's
        40px and centers its own crest, and the recovery card, which is 200px
        wide whatever the rail says, must overflow to the right, into view,
        not to both sides.
      */}
      <div className="box-border min-h-12 shrink-0 border-b border-border px-2 pt-1">
        <ChapterNavHeader collapsed={collapsed} />
      </div>
      <div
        className={cn(
          // No top padding: the nav's own 4px under the band puts the first
          // row 52px down, where the old sidebar had it.
          "flex min-h-0 flex-1 flex-col p-2 pt-0",
          collapsed && "items-center",
        )}
      >
        <AppNav
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          permissions={permissions}
          isModuleEnabled={isModuleEnabled}
          pathname={pathname}
          highlighted={highlighted}
          chatRow={chatRow}
          onCloseTool={onCloseTool}
        />
      </div>
      {/* Voice prototype (#3866): renders nothing unless its dev flag is on. */}
      <VoiceBar collapsed={collapsed} />
    </div>
  );
}
