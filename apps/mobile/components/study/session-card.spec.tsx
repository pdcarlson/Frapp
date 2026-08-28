/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentFallbackApplied: false,
    logoUrl: null,
    chapterName: null,
  }),
}));

import { SessionCard } from "./session-card";
import { SessionRow } from "./session-row";
import type { StudySessionModel } from "@/lib/study/session";

/**
 * These pin the two claims a member reads off this cluster and cannot verify:
 * that the status colour never travels alone (iconography.md), and that a
 * zero-award close says so rather than showing a duration that implies credit.
 */

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

function flatten(style: unknown): Record<string, unknown> {
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

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType("Text" as unknown as React.ComponentType)
    .flatMap((node) =>
      React.Children.toArray(node.props.children).filter(
        (child): child is string => typeof child === "string",
      ),
    );
}

const baseProps = {
  seconds: 5076,
  zoneName: "Folsom Library",
  isReportingStale: false,
  graceCopy: "Leaving the zone pauses with a 5-min grace window.",
  isEnding: false,
  onEnd: () => {},
};

describe("SessionCard", () => {
  it("renders the drawn timer and zone status while running", () => {
    const tree = render(<SessionCard {...baseProps} isPaused={false} />);
    const rendered = texts(tree);
    expect(rendered).toContain("1:24:36");
    expect(rendered).toContain("Folsom Library · inside zone");
    expect(rendered).toContain("End session");
  });

  it("never states the status by colour alone", () => {
    // iconography.md: "Never encode status with icon color alone — always pair
    // with a text label." The dot and the label must move together.
    const running = texts(render(<SessionCard {...baseProps} isPaused={false} />));
    const paused = texts(render(<SessionCard {...baseProps} isPaused />));
    expect(running.some((line) => line.includes("inside zone"))).toBe(true);
    expect(paused.some((line) => line.includes("paused"))).toBe(true);
  });

  it("paints paused as warning and running as success, from the tokens", () => {
    const dotStyle = (tree: ReactTestRenderer) =>
      tree.root
        .findAllByType("View" as unknown as React.ComponentType)
        .map((node) => flatten(node.props.style))
        .find((style) => style.width === 9);

    expect(dotStyle(render(<SessionCard {...baseProps} isPaused={false} />))).
      toMatchObject({ backgroundColor: signetDarkTokens.color.semantic.success });
    expect(dotStyle(render(<SessionCard {...baseProps} isPaused />))).toMatchObject(
      { backgroundColor: signetDarkTokens.color.semantic.warning },
    );
  });

  it("explains the pause rather than leaving a stopped clock unexplained", () => {
    const rendered = texts(render(<SessionCard {...baseProps} isPaused />));
    expect(rendered.some((line) => line.includes("background"))).toBe(true);
  });

  it("warns when the server has stopped hearing heartbeats", () => {
    // The clamped clock stops climbing, but a still-ticking card with no
    // explanation reads as a session that is fine — and the server voids it at
    // ten minutes with no points.
    const rendered = texts(
      render(<SessionCard {...baseProps} isPaused={false} isReportingStale />),
    );
    expect(rendered.some((line) => line.includes("without points"))).toBe(true);
  });

  it("does not warn about reporting while paused, where it means nothing", () => {
    const rendered = texts(
      render(<SessionCard {...baseProps} isPaused isReportingStale />),
    );
    expect(rendered.some((line) => line.includes("without points"))).toBe(false);
  });

  it("keeps the End control at the button height and disables it mid-stop", () => {
    const tree = render(<SessionCard {...baseProps} isPaused={false} isEnding />);
    const button = tree.root.findByType(
      "Pressable" as unknown as React.ComponentType,
    );
    expect(flatten(button.props.style({ pressed: false })).height).toBe(
      signetDarkTokens.touch.buttonLarge,
    );
    expect(button.props.disabled).toBe(true);
    expect(texts(tree)).toContain("Ending…");
  });
});

function session(overrides: Partial<StudySessionModel> = {}): StudySessionModel {
  return {
    id: "ss-1",
    geofenceId: "gf-1",
    status: "COMPLETED",
    startTime: "2026-08-18T19:02:00.000Z",
    endTime: "2026-08-18T21:10:00.000Z",
    lastHeartbeatAt: "2026-08-18T21:10:00.000Z",
    pausedAt: null,
    totalForegroundMinutes: 126,
    pointsAwarded: true,
    ...overrides,
  };
}

describe("SessionRow", () => {
  it("renders zone, range and duration", () => {
    const rendered = texts(
      render(
        <SessionRow session={session()} zoneName="Folsom Library" isLast />,
      ),
    );
    expect(rendered).toContain("Folsom Library");
    expect(rendered).toContain("2.1 hrs");
  });

  it("says a zero-award close earned nothing, instead of implying credit", () => {
    // An EXPIRED session still carries foreground minutes, so a bare "1.5 hrs"
    // would read exactly like a paid session (study-sessions.md § Points Award
    // awards nothing for EXPIRED or LOCATION_INVALID).
    const rendered = texts(
      render(
        <SessionRow
          session={session({ status: "EXPIRED" })}
          zoneName="Folsom Library"
          isLast
        />,
      ),
    );
    expect(rendered.some((line) => line.includes("no points"))).toBe(true);
  });

  it("falls back to a neutral name when the zone has been deleted", () => {
    const rendered = texts(
      render(<SessionRow session={session()} zoneName={null} isLast />),
    );
    expect(rendered).toContain("Study session");
  });

  it("drops the divider on the last row only", () => {
    const border = (isLast: boolean) =>
      flatten(
        render(
          <SessionRow session={session()} zoneName="Folsom" isLast={isLast} />,
        ).root.findAllByType("View" as unknown as React.ComponentType)[0]?.props
          .style,
      ).borderBottomWidth;

    expect(border(false)).toBe(1);
    expect(border(true)).toBeUndefined();
  });
});
