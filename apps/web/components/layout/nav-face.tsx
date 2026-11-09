"use client";

import { createContext, useContext } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/lib/use-media-query";

/**
 * The left column's two faces on `/chat` (owner, 2026-11-05).
 *
 * On every other route the left column is the module nav. On `/chat` it is the
 * channel list, and a back arrow beside the Channels heading slides the module
 * nav in over it without leaving Chat; the Chat row slides the channels back.
 * Chat used to spend 460px on the nav and the channel list side by side before
 * a single message (`spec/ui/web-dashboard/README.md` § Chat).
 *
 * The shell owns the column and which face shows. Chat owns what the channels
 * face holds, because the list, its filters and its selection are chat state:
 * `ChatShell` portals its channels pane into `channelsSlot`. A context rather
 * than props, because the shell renders the route as `children` and has no
 * other way to hand the route an element.
 */

export type NavFace = "channels" | "modules";

export type NavFaceContextValue = {
  face: NavFace;
  showModules: () => void;
  showChannels: () => void;
  /**
   * The channels face's container, or `null` until it mounts (and on the
   * server). Below `lg` it exists but is hidden with the rest of the desktop
   * column, so a reader also checks `useIsDesktopShell()` before portaling.
   */
  channelsSlot: HTMLElement | null;
};

export const NavFaceContext = createContext<NavFaceContextValue | null>(null);

/**
 * The shell's nav-face controls, or `null` outside the dashboard shell (a test
 * harness, a route outside `(dashboard)`), where the channels pane stays inline.
 */
export function useNavFace(): NavFaceContextValue | null {
  return useContext(NavFaceContext);
}

/** The routes whose left column is the channel list. */
export function isChannelsNavRoute(pathname: string | null): boolean {
  return pathname === "/chat" || Boolean(pathname?.startsWith("/chat/"));
}

/**
 * The shell's one breakpoint, `lg` (1024px), where the left column appears and
 * the drawer goes away (`spec/ui/web-dashboard/README.md` § Responsive contract).
 */
const DESKTOP_SHELL_QUERY = "(min-width: 1024px)";

/**
 * Whether the desktop column is on screen. `false` on the server and through
 * hydration: the channels pane renders inline (hidden from `lg` up) until the
 * client knows, while the shell's own placeholder holds the column's place, so
 * no width moves on first paint.
 */
export function useIsDesktopShell(): boolean {
  return useMediaQuery(DESKTOP_SHELL_QUERY);
}

/**
 * The back arrow beside the Channels heading, named "Back to menu"
 * (`spec/ui/design-system/components.md` § 7). Drawn only inside
 * `NavChannelsTitle`, which chat's channels header and the column's own
 * placeholder both use; the column moves focus to it by `data-nav-back`.
 *
 * 40px, and its hit area is the whole title, the arrow and the word Channels
 * (#3824, Paul 2026-11-09: "a tiny back arrow, which is the only way out"). The
 * button's `::after` stretches over the `relative` box `NavChannelsTitle` puts
 * around both, so a click anywhere on the title goes back, while the heading
 * stays a heading and the button keeps its one name for a screen reader.
 */
export function NavBackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-10 w-10 shrink-0 after:absolute after:inset-0 after:rounded-[10px] after:content-[''] hover:bg-transparent"
      onClick={onClick}
      aria-label="Back to menu"
      title="Back to menu"
      data-nav-back=""
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

/**
 * "‹ Channels": the back arrow and the column's heading as one 40px target,
 * hovered as one (see `NavBackButton`). `heading` is false for the column's
 * placeholder, which stands in for chat's pane and must not add a second
 * Channels heading beside it.
 */
export function NavChannelsTitle({
  onBack,
  heading = true,
}: {
  onBack: () => void;
  heading?: boolean;
}) {
  const Title = heading ? "h2" : "span";
  return (
    <div className="relative -ml-2 flex h-10 shrink-0 items-center rounded-[10px] pr-2.5 transition-colors hover:bg-card">
      <NavBackButton onClick={onBack} />
      <Title className="text-sm font-semibold text-foreground">Channels</Title>
    </div>
  );
}
