/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentFallbackApplied: false,
    logoUrl: null,
    chapterName: null,
  }),
}));

import { StartCard } from "./start-card";
import type { StudyZoneModel } from "@/lib/study/zones";

/**
 * Pins the one thing #2297 added to this component: Start is withdrawn when
 * the chapter's subscription refused a session write.
 *
 * WHY THIS FILE EXISTS. The wiring was originally asserted only at the call
 * site in `study.tsx` (by the source lock in
 * `scripts/ci/__tests__/subscription-refusal-parity.test.mjs`), which checks
 * that the prop is *passed*. Deleting `|| isBlocked` from both expressions
 * below — leaving the prop declared, destructured and ignored — kept the whole
 * mobile suite and the source lock green while Start stayed tappable after a
 * permanent refusal, which is exactly the retry-that-cannot-win the issue
 * closes. The prop needs an assertion at the implementation, not only at the
 * caller.
 */

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

const ZONE = {
  id: "zone-1",
  name: "Library",
  pointsPerHour: 10,
} as unknown as StudyZoneModel;

function startButton(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) => node.props?.accessibilityLabel === "Start session",
  )[0];
}

function renderStart(props: Partial<React.ComponentProps<typeof StartCard>>) {
  return render(
    <StartCard
      zone={ZONE}
      canChooseZone={false}
      isStarting={false}
      graceCopy=""
      onChooseZone={() => {}}
      onStart={() => {}}
      {...props}
    />,
  );
}

describe("StartCard, when the subscription refused a write", () => {
  it("disables Start, and says so to assistive tech", () => {
    const button = startButton(renderStart({ isBlocked: true }));
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityState.disabled).toBe(true);
  });

  it("leaves Start enabled when nothing is blocking it", () => {
    // The other direction. `isBlocked` defaults to false, so an ordinary
    // failure — which keeps its retry — must not land here.
    const button = startButton(renderStart({}));
    expect(button.props.disabled).toBe(false);
    expect(button.props.accessibilityState.disabled).toBe(false);
  });

  it("still disables Start with no zone, independently of the refusal", () => {
    const button = startButton(renderStart({ zone: null }));
    expect(button.props.disabled).toBe(true);
  });
});
