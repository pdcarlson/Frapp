/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/shared/segment-error", () => ({
  SegmentError: () => <p>chat error card</p>,
}));

import { ChatPanelBoundary } from "./chat-panel-boundary";

const state = { fail: true };
function Chat() {
  if (state.fail) throw new Error("boom");
  return <p>chat</p>;
}

describe("ChatPanelBoundary (#3779)", () => {
  it("catches chat's error, and retries chat when the route changes", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { rerender } = render(
        <ChatPanelBoundary resetKey="/events">
          <Chat />
        </ChatPanelBoundary>,
      );
      expect(screen.getByText("chat error card")).toBeInTheDocument();

      // Same route: still the card.
      rerender(
        <ChatPanelBoundary resetKey="/events">
          <Chat />
        </ChatPanelBoundary>,
      );
      expect(screen.getByText("chat error card")).toBeInTheDocument();

      state.fail = false;
      rerender(
        <ChatPanelBoundary resetKey="/tasks">
          <Chat />
        </ChatPanelBoundary>,
      );
      expect(screen.getByText("chat")).toBeInTheDocument();
    } finally {
      quiet.mockRestore();
    }
  });
});
