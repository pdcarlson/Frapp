import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BLOCK_LIST_WAITING_FOR_NETWORK } from "@repo/chat-core/block-copy";
import type { BlockListStatus } from "@repo/validation";
import { BlockListNotice } from "./block-list-notice";

function renderNotice(
  status: BlockListStatus,
  heldCount: number,
  extras: {
    isPaused?: boolean;
    isRetrying?: boolean;
    onRetry?: () => void;
  } = {},
) {
  return render(
    <BlockListNotice
      status={status}
      heldCount={heldCount}
      onRetry={extras.onRetry ?? vi.fn()}
      isRetrying={extras.isRetrying ?? false}
      isPaused={extras.isPaused ?? false}
    />,
  );
}

describe("BlockListNotice (#2313)", () => {
  it("keeps an empty live region mounted while there is nothing to say", () => {
    renderNotice("ready", 0);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
  });

  it("stays quiet while loading unless something is held", () => {
    renderNotice("loading", 0);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says rows are held while loading, with no retry", () => {
    renderNotice("loading", 2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your block list. 2 new messages are held until it loads.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("always speaks up when the list is unavailable, and retries", async () => {
    const onRetry = vi.fn();
    renderNotice("unavailable", 1, { onRetry });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn't load your block list. 1 new message is held until it loads",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Retry loading your block list" }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("says it retries on reconnect instead of offering a dead Retry", () => {
    renderNotice("unavailable", 0, { isPaused: true });
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByText(BLOCK_LIST_WAITING_FOR_NETWORK),
    ).toBeInTheDocument();
  });
});
