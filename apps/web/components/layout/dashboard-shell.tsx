"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signetDarkTokens } from "@repo/theme/signet";
import { useNotifications } from "@repo/hooks";
import { useNavPermissions } from "@/lib/hooks/use-nav-permissions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SKIP_LINK_CLASSES } from "@/components/ui/focus";
import { AppNav } from "@/components/layout/app-nav";
import { NavColumn } from "@/components/layout/nav-column";
import {
  FULL_NAV_SPLIT_QUERY,
  isChatRoute,
  isFullWidthToolRoute,
  PANE_FLOOR,
  CHANNELS_WIDTH,
  OUTSIDE_RAIL_BAND,
  RAIL_BAND_ONLY,
  SPLIT_QUERY,
  useHydrated,
  useMediaQueryState,
} from "@/components/layout/shell-layout";
import {
  persistChatOpen,
  persistToolShare,
} from "@/components/layout/shell-prefs";
import {
  SplitDivider,
  type SplitSide,
} from "@/components/layout/split-divider";
import { ToolPageHeader } from "@/components/layout/tool-page-header";
import { ChapterHome } from "@/components/layout/chapter-home";
import { ChatPanelBoundary } from "@/components/layout/chat-panel-boundary";
import { ChatPage } from "@/components/chat/chat-page";
import { ChatRouteSkeleton } from "@/components/chat/chat-route-skeleton";
import { CHAT_CHANNEL_PARAM, CHAT_MESSAGE_PARAM } from "@/lib/chat/chat-links";
import { TopBar } from "@/components/layout/top-bar";
import { DashboardNotificationDrawer } from "@/components/layout/dashboard-notification-drawer";
import { AccountMenu } from "@/components/layout/account-menu";
import { persistNavCollapsed } from "@/components/layout/nav-collapse";
import { resolvePageTitle } from "@/components/layout/page-title";
import { isNavItemVisible } from "@/components/layout/protected-nav-item";
import { useChapterTheme } from "@/lib/hooks/use-chapter-theme";
import { useChapterModuleGate } from "@/lib/hooks/use-chapter-module-gate";
import { ChapterWizardGate } from "@/components/onboarding/chapter-wizard-gate";
import { NoAccessRedirect } from "@/components/layout/no-access-redirect";
import { TermsPromptGate } from "@/components/auth/terms-prompt";
import { OnboardingTutorial } from "@/components/onboarding/onboarding-tutorial";
import { WhatsNewHost } from "@/components/whats-new/whats-new-host";
import { useChatRealtimeBinding } from "@/lib/chat/use-chat-realtime-binding";
import { useNavHighlights } from "@/components/layout/use-chat-has-unread";
import { cn } from "@/lib/utils";

/**
 * The greenfield dashboard shell: flush-left nav, 48px top bar, content.
 *
 * Three flush columns rather than a centered page. The previous shell wrapped
 * everything in `mx-auto max-w-[1400px]`, which on a wide display left the nav
 * floating in from the left edge with background either side of it. The board
 * seats the nav against the viewport edge (`1b`: "three flush columns, 100vh,
 * independent scroll") and lets content use the width it has.
 *
 * What this shell deliberately no longer does:
 *
 * - **No ⌘K palette and no keydown listener for it.** Find in the top bar is
 *   the replacement: a visible field that opens a centered dialog, as does
 *   Cmd/Ctrl+F, both owned by `find-bar.tsx`. The `cmdk` dependency stays: `components/ui/command.tsx` still
 *   serves the chat slash palette and the chapter wizard.
 * - **The page title is the top bar's**, derived from the route by
 *   `page-title.ts` (2026-11-05). It reads the nav rows' own labels rather
 *   than keeping a table of its own, and a route it does not know gets no
 *   title rather than a made-up one: the "a route with no nav row is called
 *   Dashboard" defect stays retired.
 * - **No account menu in the nav, no subscription card, no BETA row.** Identity
 *   moved to the top-bar avatar; the other two are deleted outright (`1t`).
 *
 * **Chat is a panel of the shell, not a page** (#3779, Paul 2026-11-10). The
 * nav column always stays; its Chat row opens and closes the chat panel, and
 * a tool row opens its page beside chat, on the right, with a divider between
 * them. Chat and one tool can be open; with neither, the home view
 * (`chapter-home.tsx`). `shell-layout.ts` owns the state model: the open tool
 * is the URL, chat open or closed and the divider are cookies.
 *
 * The responsive contract: below `lg` the nav lives in a drawer and the rail
 * never appears; the drawer renders the same `AppNav`, so navigation is never
 * duplicated into a second list that can drift. Below the side-by-side width
 * (`SPLIT_MIN_WIDTH`) the shell is a single page: `/chat` is chat, a tool
 * route is its tool, and the Chat row is a link.
 */

/**
 * The drawer's nav, with the rows that have something new lit (#3824). Its
 * own component so the unread reads redraw the drawer, not the shell; the
 * sheet mounts it only while open.
 */
function DrawerNav(
  props: Pick<
    React.ComponentProps<typeof AppNav>,
    "permissions" | "isModuleEnabled" | "pathname" | "onNavigate"
  >,
) {
  const highlighted = useNavHighlights();
  return (
    <AppNav
      variant="drawer"
      collapsed={false}
      highlighted={highlighted}
      {...props}
    />
  );
}

type DashboardShellProps = {
  children: React.ReactNode;
  /**
   * Collapse preference, read from a cookie by the server layout so the first
   * paint is already correct. Reading it on the client instead would render
   * 240px and then snap to 56px after hydration, on every route.
   */
  defaultNavCollapsed?: boolean;
  /** Chat open or closed, from its cookie (`shell-prefs.ts`). */
  defaultChatOpen?: boolean;
  /** The divider's tool-page share, from its cookie. */
  defaultToolShare?: number;
  /** Chat's member column preference (`lib/chat/members-panel.ts`). */
  defaultMembersHidden?: boolean;
};

/** Chat's panel enters and leaves with the standard Signet tokens. */
const PANEL_ENTER_MS = signetDarkTokens.motion.duration.context;
const PANEL_EXIT_MS = signetDarkTokens.motion.duration.standard;

export function DashboardShell({
  children,
  defaultNavCollapsed = false,
  defaultChatOpen = true,
  defaultToolShare = 0.5,
  defaultMembersHidden = false,
}: DashboardShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Chapter accent, shell-wide: maps the persisted engine roles onto the
  // semantic tokens signet.css defines. Mounted here (not in ChatProvider) so
  // the nav's active-item tint does not depend on which route is open.
  useChapterTheme();
  // Chat's inbox, joined on every page, so a message arriving while the member
  // is on Events lights the nav's Chat row within seconds (#3745).
  useChatRealtimeBinding();

  const [navCollapsed, setNavCollapsed] = useState(defaultNavCollapsed);
  const [notificationDrawerOpen, setNotificationDrawerOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Side by side: `null` until the client knows its width, so a hydration
  // render never unmounts chat beside a tool page.
  const split = useMediaQueryState(SPLIT_QUERY);
  const fullNavRoom = useMediaQueryState(FULL_NAV_SPLIT_QUERY);
  const onChatRoute = isChatRoute(pathname);
  const hasTool = !onChatRoute;

  // A chat deep link (`?channel=`, `?message=`) opens chat even when the
  // cookie says closed: the member followed a link to a message, from an
  // email, a push or sign-in, and the home view would swallow it.
  const [chatOpen, setChatOpen] = useState(
    () =>
      defaultChatOpen ||
      (onChatRoute &&
        Boolean(
          searchParams?.get(CHAT_CHANNEL_PARAM) ||
          searchParams?.get(CHAT_MESSAGE_PARAM),
        )),
  );
  const [toolShare, setToolShare] = useState(defaultToolShare);
  const splitRowRef = useRef<HTMLElement>(null);

  /*
    Arriving at a chat URL opens chat: a `/chat` link, a notification, a Find
    result, the directory's Message action. The one arrival that must not is
    the shell's own, closing a tool (`closeTool`), which goes to `/chat`
    meaning "no tool" and leaves chat as it was. Adjusted during render, keyed
    on the URL, so there is no frame of the home view first.
  */
  const url = `${pathname}?${searchParams?.toString() ?? ""}`;
  const [seenUrl, setSeenUrl] = useState(url);
  // Only an open the member asked for plays the entrance; a page load or a
  // link that opens chat paints it in place. Cleared when the entrance ends,
  // so a later remount (the window narrowing and widening) does not replay it.
  const [animateOpen, setAnimateOpen] = useState(false);
  const [closingTool, setClosingTool] = useState(false);
  if (seenUrl !== url) {
    setSeenUrl(url);
    if (closingTool) setClosingTool(false);
    else if (onChatRoute && !chatOpen) {
      setChatOpen(true);
      // A link paints chat in place; only the Chat row plays the entrance.
      setAnimateOpen(false);
    }
  }
  // The cookie follows the state, whichever way it changed.
  useEffect(() => {
    persistChatOpen(chatOpen);
  }, [chatOpen]);

  /*
    Closing plays the exit before the panel unmounts. `leaving` is the panel
    still on screen while it fades and slides out.
  */
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), PANEL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const toggleChat = useCallback(() => {
    if (chatOpen) {
      setLeaving(true);
      setAnimateOpen(false);
    } else setAnimateOpen(true);
    setChatOpen(!chatOpen);
  }, [chatOpen]);
  /*
    The X in chat's channel header (#4223): closes chat and leaves the tool
    page, which fills the row. The X goes with the panel, so focus moves to
    the page rather than dropping to `<body>`, and Escape there still closes
    the page.
  */
  const toolColumnRef = useRef<HTMLDivElement>(null);
  const closeChatPanel = useCallback(() => {
    if (!chatOpen) return;
    toggleChat();
    toolColumnRef.current?.focus();
  }, [chatOpen, toggleChat]);
  const closeTool = useCallback(() => {
    setClosingTool(true);
    router.push("/chat");
  }, [router]);

  /*
    The side a divider drag will close if released now (dragged to that
    edge), so the side can fade first and the release is no surprise.
  */
  const [collapsing, setCollapsing] = useState<SplitSide | null>(null);
  const collapseSide = useCallback(
    (side: SplitSide) => {
      setCollapsing(null);
      if (side === "page") closeTool();
      else if (chatOpen) toggleChat();
    },
    [chatOpen, closeTool, toggleChat],
  );

  /*
    Escape inside the tool page closes it, from the side-by-side width up.
    Not from a field, where Escape means "stop typing" and closing would throw
    the draft away, and not when something inside already used the key: a
    Radix dialog, menu or popover handles Escape first and marks it handled.
  */
  const onToolKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (split !== true) return;
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input, textarea, select, [contenteditable=''], [contenteditable='true']",
        )
      ) {
        return;
      }
      event.preventDefault();
      closeTool();
    },
    [split, closeTool],
  );

  // A full-width tool (Chapter settings) hides chat without closing it: the
  // cookie and the Chat row's state stay as they were, so leaving the page
  // brings chat back beside the next tool.
  const fullWidthTool = hasTool && isFullWidthToolRoute(pathname);
  const chatShown = (chatOpen || leaving) && !fullWidthTool;
  // Mounted: alone on `/chat` below the side-by-side width whatever the
  // cookie says (the single page), and beside a tool only when open there.
  const chatMounted = onChatRoute
    ? chatShown || split !== true
    : chatShown && split !== false;
  // The rail, forced while chat and a tool share a window too narrow for the
  // full nav beside both 375px floors.
  // `chatShown`, not `chatOpen`: the panel keeps its width while it plays
  // its exit, so the rail holds until it is gone.
  const forceRail =
    hasTool && chatShown && split === true && fullNavRoom === false;
  /*
    The server and hydration know the route and the chat cookie but not the
    width, so where the rail might be forced they draw both columns and let
    the band's CSS show one (#4024). Deciding it in JS instead painted the
    full nav first and clipped ~130px off the tool page until it snapped.
    From the first client render the shell knows and draws only the one CSS
    already showed, keyed so it keeps its DOM: nothing moves.

    The key is settled once, on that first render, and never follows
    `forceRail` after it: a chat toggle in the band must change the column's
    width, not remount it (focus on the Chat row, the nav's scroll and the
    chapter menu all live in it).
  */
  const hydrated = useHydrated();
  const railByCss = !hydrated && hasTool && chatShown && !navCollapsed;
  // The server drew a separate "rail" column only when `railByCss` held.
  const hydratedNavKey = forceRail && !navCollapsed ? "rail" : "column";
  const [navKey, setNavKey] = useState<"rail" | "column" | null>(null);
  if (hydrated && navKey === null) setNavKey(hydratedNavKey);

  // `undefined` hides gated rows until the read answers; `null` means the
  // offline dashboard can't ask, and shows them (`useNavPermissions`, #3854).
  const permissions = useNavPermissions();
  // Module gating: items tied to a disabled module hide once the chapter read
  // resolves. Undefined while loading means "do not gate", so nothing flashes
  // out during the initial load. Read from the member-readable current chapter,
  // never the officer-only config read (#1982; the hook says why).
  const isModuleEnabled = useChapterModuleGate();
  // The crumb's parent link follows its nav row's gates, so the top bar never
  // offers a member the Settings door the nav hides from them.
  const pageTitle = useMemo(
    () =>
      resolvePageTitle(pathname, (item) =>
        isNavItemVisible(item, permissions, isModuleEnabled),
      ),
    [pathname, permissions, isModuleEnabled],
  );

  const { data: notificationsData } = useNotifications();
  const unreadNotifications = useMemo(() => {
    if (!Array.isArray(notificationsData)) return 0;
    return (notificationsData as Array<{ read_at?: string | null }>).filter(
      (n) => !n.read_at,
    ).length;
  }, [notificationsData]);

  const toggleNavCollapsed = useCallback(() => {
    // The cookie write is deliberately OUTSIDE the updater. React requires an
    // updater to be pure and double-invokes it under Strict Mode; the write is
    // idempotent so nothing breaks today, but a side effect in that position is
    // the kind that starts misbehaving the moment it stops being idempotent.
    setNavCollapsed((prev) => !prev);
    persistNavCollapsed(!navCollapsed);
  }, [navCollapsed]);

  const chatPanelClassName = cn(
    "flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
    onChatRoute
      ? // Alone: the whole row. Closed, it still shows below the
        // side-by-side width, where `/chat` is the chat page.
        cn("flex-1", !chatShown && "min-[1056px]:hidden")
      : // Beside a tool: from the side-by-side width up only.
        "hidden shrink min-[1056px]:flex",
    // A divider drag about to close chat fades it first.
    collapsing === "chat" && "opacity-40 transition-opacity",
  );
  const chatPanelStyle: React.CSSProperties = {
    // Keyframes in `app/globals.css`, off under reduced motion.
    animation: leaving
      ? `shell-panel-out ${PANEL_EXIT_MS}ms ${signetDarkTokens.motion.easing.exit} forwards`
      : animateOpen
        ? `shell-panel-in ${PANEL_ENTER_MS}ms ${signetDarkTokens.motion.easing.entrance}`
        : undefined,
    ...(hasTool
      ? {
          // The channels column, then the messages' part of what is left.
          // CSS holds both floors: chat never below channels + 375, and the
          // tool page (`min-w-[375px]`) never below 375, whatever the share.
          flexBasis: `calc(${CHANNELS_WIDTH}px + (100% - ${CHANNELS_WIDTH + 1}px) * ${(1 - toolShare).toFixed(4)})`,
          minWidth: CHANNELS_WIDTH + PANE_FLOOR,
        }
      : {}),
  };
  const showDivider = hasTool && chatShown && split !== false;

  return (
    /*
      The visible viewport's height. The connection pill sits in the top bar
      (`connection-pill.tsx`) and takes no row of its own, so nothing here
      makes room for it. This used to subtract the banner's published height,
      and that is exactly what moved the whole shell down every time the state
      left ONLINE (#2244). `data-dashboard-shell` is how the root layout's
      floating pill knows to stand down while the bar carries one.

      `dvh`, not `vh`: on a phone browser whose toolbar can hide, `100vh` is
      the viewport with the toolbar hidden, so a shell that clips its overflow
      would put chat's composer under the toolbar while it shows.

      `relative overflow-clip` is load-bearing, both halves (#4000). An
      element's overflow clips only the boxes whose containing block is it or
      inside it. Without a position here, every `absolute` box in the shell
      (each `sr-only` label, a Radix control's hidden input) took the initial
      containing block, the viewport, and sat at its unscrolled place in a
      long page. Nothing clipped it, so the document grew past the viewport
      and scrolled the whole shell up, leaving a black band below it.
      `relative` makes this the containing block. `clip`, not `hidden`,
      because a `hidden` box is still a scroll container: those same boxes
      became its scrollable overflow, and the skip link, a focused control or
      a `scrollIntoView` scrolled the shell instead, with no way for a wheel
      to scroll it back. A `clip` box cannot be scrolled at all.
    */
    <div
      data-dashboard-shell=""
      className="relative flex h-dvh overflow-clip bg-background"
    >
      <ChapterWizardGate />
      {/* A member whose roles grant nothing (#3236). */}
      <NoAccessRedirect />
      {/* A member who hasn't accepted the current Terms (#2302). */}
      <TermsPromptGate />
      <OnboardingTutorial />
      {/* What's new, by itself once after an update (#3943). */}
      <WhatsNewHost />
      <DashboardNotificationDrawer
        open={notificationDrawerOpen}
        onOpenChange={setNotificationDrawerOpen}
      />

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        {/*
          The drawer is the sidebar: it renders the same `AppNav`, never a
          second hand-maintained list. It supplies the scroll container and the
          account block, which on desktop live in the top bar instead.
        */}
        <SheetContent
          side="left"
          className="flex flex-col border-border bg-surface-1 p-2 text-foreground"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>
              Open dashboard routes and chapter tools.
            </SheetDescription>
          </SheetHeader>
          <DrawerNav
            permissions={permissions}
            isModuleEnabled={isModuleEnabled}
            pathname={pathname}
            onNavigate={() => setMobileNavOpen(false)}
          />
          <div className="mt-2 shrink-0 border-t border-border pt-2">
            <AccountMenu
              variant="sheet"
              onNavigate={() => setMobileNavOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <a href="#main-content" className={SKIP_LINK_CLASSES}>
        Skip to main content
      </a>

      {/*
        The nav column always stays (#3779): one column on every route, so
        nothing in it jumps going in and out of Chat.
      */}
      <div className="hidden lg:flex">
        {(railByCss ? [false, true] : [navCollapsed || forceRail]).map(
          (rail) => (
            <NavColumn
              key={
                railByCss
                  ? rail
                    ? "rail"
                    : "column"
                  : (navKey ?? hydratedNavKey)
              }
              className={
                railByCss
                  ? rail
                    ? RAIL_BAND_ONLY
                    : OUTSIDE_RAIL_BAND
                  : undefined
              }
              collapsed={rail}
              onToggleCollapsed={
                forceRail || (railByCss && rail)
                  ? undefined
                  : toggleNavCollapsed
              }
              permissions={permissions}
              isModuleEnabled={isModuleEnabled}
              pathname={pathname}
              chatRow={
                // Beside a full-width tool the Chat row is the link to
                // `/chat` it is below the side-by-side width: a toggle would
                // open a panel the page has no room for.
                split === true && !fullWidthTool
                  ? { onSelect: toggleChat, open: chatOpen }
                  : undefined
              }
              onCloseTool={split === true && hasTool ? closeTool : undefined}
            />
          ),
        )}
      </div>

      {/*
        `min-w-0` is load-bearing, not tidying. This column is a flex item, so
        its automatic minimum size is its min-content width — without the
        override it refuses to shrink below whatever the widest unbreakable
        thing on the route needs, and the whole page scrolls sideways. That one
        missing declaration was six of the seven routes in #1142.
      */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          // The home view is no page: "Chat" over it would name what's closed.
          pageTitle={
            onChatRoute && !chatShown && split === true ? null : pageTitle
          }
          // A tool page's title is its own header's from the side-by-side
          // width up (`tool-page-header.tsx`).
          titleMovesBesideChat={hasTool}
          titleIsHeading={!(hasTool && split === true)}
          unreadNotifications={unreadNotifications}
          onOpenNotifications={() => setNotificationDrawerOpen(true)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        {/*
          `<main>` is the whole row right of the nav: chat, the divider and
          the tool page (#3779). One landmark for everything the member came
          for, so the skip link, the confirm dialog's focus fallback
          (`confirm-dialog.tsx`) and the 375px floor suite, which measures
          inside `<main>`, all reach chat as well as the page.
        */}
        <main
          id="main-content"
          ref={splitRowRef}
          className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          {chatMounted ? (
            <section
              id="chat-panel"
              aria-label="Chat"
              data-chat-panel=""
              inert={leaving}
              className={chatPanelClassName}
              style={chatPanelStyle}
              onAnimationEnd={() => setAnimateOpen(false)}
            >
              <ChatPanelBoundary resetKey={pathname}>
                {/*
                  Beside a tool, chat mounts once the window is known to be
                  wide enough. Until then (server render, hydration) the
                  panel holds its place with chat's skeleton, so a phone never
                  builds and tears down a chat it cannot show.
                */}
                {onChatRoute || split === true ? (
                  <ChatPage
                    defaultMembersHidden={defaultMembersHidden}
                    toolBeside={hasTool}
                    onClose={
                      hasTool && split === true ? closeChatPanel : undefined
                    }
                  />
                ) : (
                  <ChatRouteSkeleton />
                )}
              </ChatPanelBoundary>
            </section>
          ) : null}
          {showDivider ? (
            <div className="hidden min-[1056px]:flex">
              <SplitDivider
                share={toolShare}
                onChange={setToolShare}
                onCommit={persistToolShare}
                rowRef={splitRowRef}
                onCollapsePreview={setCollapsing}
                onCollapse={collapseSide}
              />
            </div>
          ) : null}
          {/*
            The tool page. It scrolls independently of the nav, which is what
            makes the nav's own scroll position survive navigation. `min-w-0`
            and `min-h-0` are load-bearing: as flex items, without them this
            refuses to shrink below its widest unbreakable content and the
            whole page scrolls sideways (six of the seven routes in #1142).
            Beside chat it keeps the 375px floor.
          */}
          {hasTool ? (
            <div
              ref={toolColumnRef}
              data-tool-column=""
              onKeyDown={onToolKeyDown}
              // Focusable by click only, so a click on the page's blank space
              // puts focus in the page and Escape reaches it, rather than
              // leaving focus on `<body>`. Never a Tab stop.
              tabIndex={-1}
              className={cn(
                // `relative`: a docked panel (`shared/panel.tsx`) covers the column.
                "relative flex min-h-0 min-w-0 flex-1 flex-col outline-none transition-opacity",
                chatShown && "min-[1056px]:min-w-[375px]",
                collapsing === "page" && "opacity-40",
              )}
            >
              <ToolPageHeader
                pageTitle={pageTitle}
                titleIsHeading={split === true}
                onClose={closeTool}
              />
              <div
                data-tool-page=""
                className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-6"
              >
                {children}
              </div>
            </div>
          ) : chatShown ? null : (
            // `/chat` with chat closed: the home view, from the side-by-side
            // width up (below it `/chat` is the chat page).
            <div className="hidden min-h-0 min-w-0 flex-1 min-[1056px]:flex">
              <ChapterHome />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
