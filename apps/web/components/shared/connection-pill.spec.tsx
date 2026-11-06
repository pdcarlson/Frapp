import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  resetOpenChatTransportForTests,
  useReportOpenChatTransport,
} from "@repo/hooks/open-chat-transport";
import type { RealtimeTransportStatus } from "@repo/validation";
import { ConnectionPill } from "./connection-pill";
import {
  CONNECTION_PILL_ATTR,
  DASHBOARD_SHELL_ATTR,
} from "./connection-pill-focus";
import * as NetworkProvider from "@/lib/providers/network-provider";

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: vi.fn(),
}));

afterEach(() => {
  act(() => resetOpenChatTransportForTests());
});

function mockNetwork(state: "ONLINE" | "DEGRADED" | "OFFLINE") {
  vi.mocked(NetworkProvider.useNetwork).mockReturnValue({
    state,
    isOnline: state === "ONLINE",
    isDegraded: state === "DEGRADED",
    isOffline: state === "OFFLINE",
    linkOnline: state !== "OFFLINE",
    probeOnce: async () => {},
  });
}

/** Stands in for a chat screen reporting its transport. */
function OpenChat({ status }: { status: RealtimeTransportStatus }) {
  useReportOpenChatTransport(status);
  return null;
}

describe("ConnectionPill", () => {
  it("renders nothing while ONLINE with no chat open", () => {
    mockNetwork("ONLINE");
    const { container } = render(<ConnectionPill />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws a short label and announces the whole sentence when offline", () => {
    mockNetwork("OFFLINE");
    render(<ConnectionPill placement="top-bar" />);

    const pill = screen.getByRole("alert");
    expect(pill).toHaveAttribute(CONNECTION_PILL_ATTR);
    expect(pill).toHaveAttribute("tabindex", "-1");
    expect(pill).toHaveAttribute(
      "title",
      "You're offline. Showing cached data.",
    );
    // The drawn label is short; the sentence is for a screen reader. The
    // queue promise is absent: no chat is open, and nothing else queues.
    expect(screen.getByText("Offline")).toHaveAttribute("aria-hidden", "true");
    expect(pill).toHaveTextContent("You're offline. Showing cached data.");
    expect(pill).not.toHaveTextContent(/reconnect/i);
  });

  it("says Slow connection when DEGRADED", () => {
    mockNetwork("DEGRADED");
    render(<ConnectionPill placement="top-bar" />);
    expect(screen.getByText("Slow connection")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute(
      "title",
      "Slow connection. Some features may be delayed.",
    );
  });

  /*
   * 2026-11-06: a chat screen showed offline three times (this pill, a header
   * pill, a line under the composer) and slow connection twice. The chat now
   * reports its transport here instead of drawing it.
   */
  describe("one indicator for the app and the open chat", () => {
    it("carries the outbox's promise only while a chat is open", () => {
      mockNetwork("OFFLINE");
      render(
        <>
          <OpenChat status="offline" />
          <ConnectionPill placement="top-bar" />
        </>,
      );
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Messages you send go out when you reconnect.",
      );
    });

    it("lets the app's slow connection speak over a reconnecting transport", () => {
      mockNetwork("DEGRADED");
      render(
        <>
          <OpenChat status="reconnecting" />
          <ConnectionPill placement="top-bar" />
        </>,
      );
      expect(screen.getByText("Slow connection")).toBeInTheDocument();
      expect(screen.queryByText("Reconnecting…")).not.toBeInTheDocument();
    });

    it("reports a polling transport on an otherwise healthy connection", () => {
      mockNetwork("ONLINE");
      render(
        <>
          <OpenChat status="polling" />
          <ConnectionPill placement="top-bar" />
        </>,
      );
      expect(screen.getByText("Live updates paused")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveAttribute(
        "title",
        "Real-time updates paused. Polling for new messages.",
      );
    });

    it("clears when the chat closes", () => {
      mockNetwork("ONLINE");
      const { rerender } = render(
        <>
          <OpenChat status="reconnecting" />
          <ConnectionPill placement="top-bar" />
        </>,
      );
      expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
      rerender(<ConnectionPill placement="top-bar" />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("floats for the routes with no top bar and stands down inside the shell", () => {
    mockNetwork("DEGRADED");
    const { container } = render(<ConnectionPill />);

    const overlay = container.firstElementChild;
    // Takes no layout space and no pointer (#2244).
    expect(overlay).toHaveClass("fixed", "z-40", "pointer-events-none");
    // The attribute is spelled literally in the class (Tailwind has to see
    // it), so pin it to the constant the shell spec pins its side against.
    expect(overlay?.className).toContain(
      `[html:has([${DASHBOARD_SHELL_ATTR}])_&]:hidden`,
    );
  });

  it("sits in the flow of the top bar, with no dismiss control", () => {
    mockNetwork("OFFLINE");
    const { container } = render(<ConnectionPill placement="top-bar" />);
    expect(container.firstElementChild).toBe(screen.getByRole("alert"));
    expect(container.firstElementChild?.className).not.toMatch(/\bfixed\b/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
