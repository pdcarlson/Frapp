/** @vitest-environment jsdom */
import React from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentPrimary: "#F4CB63",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#3A2F14",
    accentBorder: "#6E5523",
    logoUrl: null,
    chapterName: null,
  }),
}));

// The screens' skeletons are imported from their route files, which reach
// native modules through these; the skeletons use none of them.
vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ email: null }),
}));
vi.mock("@/components/profile/profile-photo", () => ({
  PROFILE_PHOTO_SIZE: 84,
  ProfilePhoto: "ProfilePhoto",
}));
vi.mock("@/lib/ask/flag", () => ({ isAskAvailable: () => false }));

import {
  SkeletonBlock,
  SkeletonPulse,
  SkeletonRegion,
  SkeletonText,
} from "./state-block";
import { HistoryRow, HistoryRowsSkeleton } from "./history-row";
import { ListRow, ListRowSkeleton, ListSection } from "./list-section";
import { TaskRow, TaskRowSkeleton } from "./tasks/task-row";
import { ChoiceRow, ChoiceRowSkeleton } from "./auth/choice-row";
import { CardListSkeleton } from "./card-list-skeleton";
import { BalanceCardSkeleton } from "./dues/balance-card";
import { StartCardSkeleton } from "./study/start-card";
import { ThreadSkeleton } from "./chat/thread-skeleton";
import { ChannelListSkeleton } from "./chat/channel-row";
import { JoinedChannelsSkeleton } from "./onboarding/joined-channels-card";
import { EventListSkeleton } from "@/app/(tabs)/events";
import { EventDetailSkeleton } from "@/app/(tabs)/event-details";
import {
  NotificationListRow,
  NotificationListSkeleton,
} from "@/app/(tabs)/notifications";
import { ProfileSkeleton } from "@/app/(tabs)/profile";

/**
 * components.md §10: "the skeleton mirrors the layout it becomes — same
 * blocks, same radii". These pin the three things that rule needs on mobile:
 * a text line's placeholder is as tall as the text, a placeholder row sits on
 * the real row's frame, and no screen goes back to the one generic card of
 * bars or a spinner over a "Loading…" caption.
 */

const tokens = signetDarkTokens;
const { role } = tokens.typography;

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

function flatten(style: unknown): Record<string, unknown> {
  if (typeof style === "function") {
    return flatten(
      (style as (s: { pressed: boolean }) => unknown)({ pressed: false }),
    );
  }
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => ({ ...acc, ...flatten(entry) }),
      {},
    );
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

/** The resolved style of the first host node of `type` (a string stand-in). */
function firstStyle(tree: ReactTestRenderer, type: string) {
  const [node] = tree.root.findAll(
    (candidate) => (candidate.type as unknown) === type,
  );
  if (!node) throw new Error(`no ${type} rendered`);
  return flatten(node.props.style);
}

/** The frame properties a placeholder row has to share with its real row. */
const FRAME_KEYS = [
  "flexDirection",
  "alignItems",
  "gap",
  "padding",
  "paddingVertical",
  "paddingHorizontal",
  "minHeight",
  "borderRadius",
  "borderWidth",
  "borderColor",
  "backgroundColor",
] as const;

function frame(style: Record<string, unknown>) {
  return Object.fromEntries(FRAME_KEYS.map((key) => [key, style[key]]));
}

describe("SkeletonText", () => {
  function lineBox(tree: ReactTestRenderer) {
    const [box] = tree.root.findAllByType("View" as never);
    return flatten(box!.props.style);
  }
  function bar(tree: ReactTestRenderer) {
    return flatten(tree.root.findByType("Animated.View" as never).props.style);
  }

  // Figtree draws a line with no `lineHeight` at 1.2em (ascender 950,
  // descender 250 per 1000), so a 14pt label is 17pt tall. A bar in a box of
  // that height is a row as tall as the row it becomes.
  it("takes the line box the role's text draws at", () => {
    const label = render(<SkeletonText role={role.label} width="50%" />);
    expect(lineBox(label).height).toBe(17);
    expect(lineBox(label).width).toBe("50%");

    const caption = render(<SkeletonText role={role.caption} width="50%" />);
    expect(lineBox(caption).height).toBe(15);

    // A role that sets its own line height keeps it.
    const body = render(<SkeletonText role={role.body} width="50%" />);
    expect(lineBox(body).height).toBe(role.body.lineHeight);

    // So does a style that overrides it (Notifications' 20pt rows).
    const set = render(
      <SkeletonText role={role.label} lineHeight={20} width="50%" />,
    );
    expect(lineBox(set).height).toBe(20);
  });

  it("draws its bar at the role's cap height, as a SkeletonBlock", () => {
    const tree = render(<SkeletonText role={role.title} width="40%" />);
    // One drawn block (a block outside a pulse renders itself again inside
    // one, so its component appears twice in the tree).
    expect(tree.root.findAllByType("Animated.View" as never)).toHaveLength(1);
    expect(tree.root.findAllByType(SkeletonBlock).length).toBeGreaterThan(0);
    expect(bar(tree).height).toBe(13);
    expect(bar(tree).width).toBe("100%");
    expect(bar(tree).backgroundColor).toBe(tokens.color.surface.popover);
  });
});

describe("SkeletonRegion", () => {
  it("is one busy node, named for what is loading", () => {
    const tree = render(
      <SkeletonRegion label="Loading events">
        <SkeletonText role={role.label} width="50%" />
      </SkeletonRegion>,
    );
    const [region] = tree.root.findAllByType("View" as never);

    expect(region!.props.accessible).toBe(true);
    expect(region!.props.accessibilityRole).toBe("progressbar");
    expect(region!.props.accessibilityLabel).toBe("Loading events");
  });

  it("drives every block inside it from one pulse", () => {
    const tree = render(
      <SkeletonRegion label="Loading">
        <SkeletonText role={role.label} width="50%" />
        <SkeletonText role={role.caption} width="30%" />
      </SkeletonRegion>,
    );
    expect(tree.root.findAllByType(SkeletonPulse)).toHaveLength(1);
  });

  it("passes a block's outer layout through without changing its look", () => {
    const tree = render(
      <SkeletonBlock width={10} height={10} style={{ marginTop: 8 }} />,
    );
    const style = flatten(
      tree.root.findByType("Animated.View" as never).props.style,
    );
    expect(style.marginTop).toBe(8);
    expect(style.borderRadius).toBe(tokens.radius.chip);
  });

  // `style` is layout only: a caller's fill or opacity never wins over the
  // neutral block or the shared pulse.
  it("never lets a caller's style override the block's look", () => {
    const tree = render(
      <SkeletonPulse>
        <SkeletonBlock
          width={10}
          height={10}
          style={{ backgroundColor: "#FF0000", opacity: 0.1, borderRadius: 0 }}
        />
      </SkeletonPulse>,
    );
    const style = flatten(
      tree.root.findByType("Animated.View" as never).props.style,
    );
    expect(style.backgroundColor).toBe(tokens.color.surface.popover);
    expect(style.borderRadius).toBe(tokens.radius.chip);
    expect(style.opacity).not.toBe(0.1);
  });
});

/**
 * Every skeleton's shapes are `SkeletonBlock`s, so the shimmer lands in one
 * place: no host `View` paints the skeleton fill itself.
 */
describe("Every skeleton draws its shapes with SkeletonBlock", () => {
  const SKELETONS: [string, React.ReactElement][] = [
    [
      "CardListSkeleton",
      <CardListSkeleton
        key="c"
        label="Loading"
        card={<BalanceCardSkeleton />}
        summary
      />,
    ],
    ["StartCardSkeleton", <StartCardSkeleton key="s" />],
    ["ThreadSkeleton", <ThreadSkeleton key="t" />],
    ["ChannelListSkeleton", <ChannelListSkeleton key="ch" />],
    ["JoinedChannelsSkeleton", <JoinedChannelsSkeleton key="j" />],
    ["EventListSkeleton", <EventListSkeleton key="e" />],
    ["EventDetailSkeleton", <EventDetailSkeleton key="ed" />],
    ["NotificationListSkeleton", <NotificationListSkeleton key="n" />],
    ["ProfileSkeleton", <ProfileSkeleton key="p" />],
  ];

  it.each(SKELETONS)("%s", (_, node) => {
    const tree = render(node);
    const handDrawn = tree.root
      .findAllByType("View" as never)
      .filter(
        (view) =>
          flatten(view.props.style).backgroundColor ===
          tokens.color.surface.popover,
      );
    expect(handDrawn).toHaveLength(0);
    expect(tree.root.findAllByType(SkeletonBlock).length).toBeGreaterThan(0);
  });
});

describe("Screen skeletons sit on their screen's frames", () => {
  const views = (tree: ReactTestRenderer) =>
    tree.root.findAllByType("View" as never).map((v) => flatten(v.props.style));

  it("Events: cards on the event card's frame, with the 52pt date column", () => {
    const tree = render(<EventListSkeleton cards={2} />);
    const cards = views(tree).filter(
      (style) => style.borderRadius === tokens.radius.cardLarge,
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      flexDirection: "row",
      gap: tokens.spacing.md,
      padding: tokens.spacing.lg,
      borderWidth: 1,
      backgroundColor: tokens.color.surface.card,
    });
    expect(views(tree).filter((style) => style.width === 52)).toHaveLength(2);
  });

  it("Event details: the check-in card's frame and the calendar button's", () => {
    const tree = render(<EventDetailSkeleton />);
    expect(
      views(tree).filter(
        (style) =>
          style.borderRadius === tokens.radius.card &&
          style.padding === tokens.spacing.lg,
      ),
    ).toHaveLength(1);
    expect(views(tree).filter((style) => style.height === 50)).toHaveLength(1);
  });

  it("Notifications: rows on the row's frame, with 20pt title and body lines", () => {
    const real = render(
      <NotificationListRow
        row={
          {
            id: "n-1",
            title: "Dues reminder",
            body: "Spring dues are open.",
            categoryLabel: "Dues",
            time: "9:41 PM",
            isUnread: false,
            href: "/dues",
          } as never
        }
        onPress={() => {}}
      />,
    );
    const skeleton = render(<NotificationListSkeleton rows={1} />);
    const row = views(skeleton).find((style) => style.minHeight !== undefined)!;

    expect(frame(row)).toEqual(frame(firstStyle(real, "Pressable")));
    expect(views(skeleton).filter((style) => style.height === 20)).toHaveLength(
      2,
    );
  });

  it("Profile: the photo's circle, two stat cards and four detail rows", () => {
    const tree = render(<ProfileSkeleton />);
    const photo = tree.root
      .findAllByType("Animated.View" as never)
      .map((node) => flatten(node.props.style))
      .find((style) => style.width === 84);
    expect(photo?.borderRadius).toBe(42);
    expect(
      views(tree).filter(
        (style) =>
          style.flex === 1 &&
          style.backgroundColor === tokens.color.surface.surface1,
      ),
    ).toHaveLength(2);
    expect(tree.root.findAllByType(ListRowSkeleton)).toHaveLength(4);
  });

  it("Joined channels: rows on the card row's frame", () => {
    const tree = render(<JoinedChannelsSkeleton rows={3} />);
    const rows = views(tree).filter(
      (style) => style.minHeight === tokens.touch.minimum,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
    });
  });
});

describe("Placeholder rows sit on their real row's frame", () => {
  it("HistoryRow", () => {
    const real = render(
      <HistoryRow title="Food drive" meta="Oct 3" isLast={false} />,
    );
    const skeleton = render(
      <HistoryRowsSkeleton rows={2} trailingWidth={48} />,
    );
    const [, firstRow] = skeleton.root.findAllByType("View" as never);

    expect(frame(flatten(firstRow!.props.style))).toEqual(
      frame(firstStyle(real, "View")),
    );
    // And its hairline, under every row but the last.
    expect(flatten(firstRow!.props.style).borderBottomWidth).toBe(1);
  });

  it("ListRow, in a ListSection", () => {
    const real = render(<ListRow label="Bylaws" description="PDF" />);
    const skeleton = render(
      <ListSection>
        <ListRowSkeleton description />
      </ListSection>,
    );
    const rows = skeleton.root
      .findAllByType("View" as never)
      .filter((node) => flatten(node.props.style).minHeight !== undefined);

    expect(rows).toHaveLength(1);
    expect(frame(flatten(rows[0]!.props.style))).toEqual(
      frame(firstStyle(real, "View")),
    );
  });

  it("TaskRow", () => {
    const real = render(
      <TaskRow
        row={{
          id: "t-1",
          title: "Clean the kitchen",
          storedStatus: "TODO",
          displayStatus: "TODO",
          dueDate: null,
          completedAt: null,
          pointReward: 5,
          pointsAwarded: false,
          isDone: false,
          isOverdue: false,
        }}
        now={new Date("2026-11-05T12:00:00Z")}
      />,
    );
    const skeleton = render(<TaskRowSkeleton />);

    expect(frame(firstStyle(skeleton, "View"))).toEqual(
      frame(firstStyle(real, "View")),
    );
    // The checkbox's square, at the checkbox's size.
    const [box] = skeleton.root.findAllByType(SkeletonBlock);
    expect(box!.props.width).toBe(tokens.spacing.xl);
    expect(box!.props.height).toBe(tokens.spacing.xl);
  });

  it("ChoiceRow", () => {
    const real = render(
      <ChoiceRow title="Tau Nu" body="RPI" onPress={() => {}} />,
    );
    const skeleton = render(<ChoiceRowSkeleton />);

    expect(frame(firstStyle(skeleton, "View"))).toEqual(
      frame(firstStyle(real, "Pressable")),
    );
  });
});

describe("CardListSkeleton", () => {
  it("draws every shape as a SkeletonBlock, so the shimmer lands once", () => {
    const tree = render(
      <CardListSkeleton
        label="Loading your dues"
        card={<BalanceCardSkeleton />}
        rows={3}
        summary
      />,
    );
    const blocks = tree.root.findAllByType(SkeletonBlock);
    const drawn = tree.root.findAllByType("Animated.View" as never);

    // Card: label, amount, button. Summary: two. Caption: one. Rows: three
    // of title, meta and trailing.
    expect(blocks).toHaveLength(3 + 2 + 1 + 9);
    expect(drawn).toHaveLength(blocks.length);
  });

  it("is one busy node with one pulse", () => {
    const tree = render(
      <CardListSkeleton
        label="Loading study zones"
        card={<StartCardSkeleton />}
      />,
    );
    const progress = tree.root.findAll(
      (node) => node.props.accessibilityRole === "progressbar",
    );
    expect(progress).toHaveLength(1);
    expect(tree.root.findAllByType(SkeletonPulse)).toHaveLength(1);
  });

  // Each screen's card draws its own skeleton, so Study's start card (a zone
  // row and a grace line) and Dues' balance card (a display-size amount) each
  // land in place, rather than one approximate card serving both.
  it("draws each card's own button at that card's height", () => {
    const button = (node: React.ReactElement) =>
      render(node)
        .root.findAllByType(SkeletonBlock)
        .find(
          (block) => block.props.width === "100%" && block.props.height > 40,
        )!.props.height;

    expect(button(<StartCardSkeleton />)).toBe(tokens.touch.buttonLarge);
    expect(button(<BalanceCardSkeleton />)).toBe(50);
  });
});

/**
 * The guard against drifting back. A screen's loading state is its own
 * layout (the skeletons above), never the generic one card of bars, and never
 * a spinner over a "Loading…" caption. A spinner inside a control that is
 * working (a busy row, a submitting button) is not a loading state and is not
 * matched here.
 */
describe("Loading states stay shaped like their screens", () => {
  const root = join(__dirname, "..");

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx$/.test(name) && !/\.spec\.tsx$/.test(name) ? [path] : [];
    });
  }

  const files = [
    ...sources(join(root, "app")),
    ...sources(join(root, "components")),
    ...sources(join(root, "lib")),
  ];

  /**
   * Places still on the generic card, each a card itself or a sheet panel
   * the per-screen pass didn't reach. This list only shrinks.
   */
  const GENERIC_ALLOWED = new Set([
    "components/ask/answer-card.tsx",
    "components/directory/member-detail-sheet.tsx",
    "components/settings/blocked-members-sheet.tsx",
    "components/state-block.tsx",
  ]);

  /** The allowlist is written with `/`, whatever the host's separator. */
  const posixRelative = (path: string) =>
    relative(root, path).split(sep).join("/");

  /**
   * A spinner next to a "Loading…" caption, in either order, with the
   * ellipsis character or three dots.
   */
  const SPINNER_OVER_CAPTION = [
    /<ActivityIndicator[^]{0,200}?Loading[^<]*(…|\.\.\.)/,
    /Loading[^<]*(…|\.\.\.)[^]{0,200}?<ActivityIndicator/,
  ];

  it("keeps the generic card of bars off every screen", () => {
    const offenders = files
      .filter((path) => /<SkeletonLines\b/.test(readFileSync(path, "utf8")))
      .map(posixRelative)
      .filter((path) => !GENERIC_ALLOWED.has(path));

    expect(offenders).toEqual([]);
  });

  it("never sets a spinner over a Loading caption", () => {
    const offenders = files
      .filter((path) =>
        SPINNER_OVER_CAPTION.some((pattern) =>
          pattern.test(readFileSync(path, "utf8")),
        ),
      )
      .map(posixRelative);

    expect(offenders).toEqual([]);
  });
});
