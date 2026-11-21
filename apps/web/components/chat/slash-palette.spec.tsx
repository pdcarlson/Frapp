import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { SlashPalette } from "./slash-palette";

// cmdk + Radix Dialog touch a few APIs that jsdom doesn't ship; stub the
// minimum surface so the dialog can mount without throwing.
beforeAll(() => {
  if (typeof window.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      configurable: true,
      value: RO,
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = function hasPointerCapture() {
      return false;
    };
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture =
      function releasePointerCapture() {};
  }
});

const noop = () => {};

describe("SlashPalette", () => {
  it("renders the loading state and no commands while the chapter config is loading", () => {
    render(
      <SlashPalette
        open
        isModuleEnabled={() => false}
        status="loading"
        onSelect={noop}
        onOpenChange={noop}
      />,
    );

    expect(screen.getByText(/loading commands/i)).toBeInTheDocument();
    // No catalog items are selectable while loading.
    expect(screen.queryByText("/event")).not.toBeInTheDocument();
    expect(screen.queryByText("/poll")).not.toBeInTheDocument();
    expect(screen.queryByText("/announce")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/type a command/i),
    ).not.toBeInTheDocument();
  });

  it("renders an explicit error state with Retry when the chapter config errors", () => {
    const onRetry = vi.fn();
    render(
      <SlashPalette
        open
        isModuleEnabled={() => false}
        status="error"
        onRetry={onRetry}
        onSelect={noop}
        onOpenChange={noop}
      />,
    );

    expect(screen.getByText(/modules unavailable/i)).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/type a command/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("/event")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says it is offline, with Retry, rather than loading forever, when the read can't run (#3160)", () => {
    // A paused read never answers by itself, so the Loading panel would sit
    // there with no way forward. README §4: state the offline check and offer
    // the recovery.
    const onRetry = vi.fn();
    render(
      <SlashPalette
        open
        isModuleEnabled={() => false}
        status="offline"
        onRetry={onRetry}
        onSelect={noop}
        onOpenChange={noop}
      />,
    );

    expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading commands/i)).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/type a command/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("/event")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides commands whose module is disabled when ready", () => {
    render(
      <SlashPalette
        open
        // polls is the only disabled module; everything else (including the
        // null-module /announce) is enabled.
        isModuleEnabled={(key) => key !== "polls"}
        status="ready"
        onSelect={noop}
        onOpenChange={noop}
      />,
    );

    expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
    expect(screen.getByText("/event")).toBeInTheDocument();
    expect(screen.getByText("/announce")).toBeInTheDocument();
    expect(screen.queryByText("/poll")).not.toBeInTheDocument();
  });

  it("lists every catalog command when the chapter has all modules enabled", () => {
    render(
      <SlashPalette
        open
        isModuleEnabled={() => true}
        status="ready"
        onSelect={noop}
        onOpenChange={noop}
      />,
    );

    expect(screen.getByText("/event")).toBeInTheDocument();
    expect(screen.getByText("/poll")).toBeInTheDocument();
    expect(screen.getByText("/announce")).toBeInTheDocument();
  });

  // #3414: the server refuses an announcement from anyone who can't post in
  // the announcements channel, so the palette doesn't offer it to them.
  it("leaves /announce out for a member who can't post announcements", () => {
    render(
      <SlashPalette
        open
        isModuleEnabled={() => true}
        canAnnounce={false}
        status="ready"
        onSelect={noop}
        onOpenChange={noop}
      />,
    );

    expect(screen.getByText("/event")).toBeInTheDocument();
    expect(screen.queryByText("/announce")).not.toBeInTheDocument();
  });

  // #396: Radix's `DialogContent` never sets `aria-modal` on its own
  // (verified against @radix-ui/react-dialog@1.1.23 — only `role="dialog"`
  // comes for free), so a screen reader could treat this as a non-modal
  // region and let a swipe/arrow gesture escape into the composer behind it
  // while the palette is open. `apps/web/components/ui/dialog.tsx` now sets
  // it explicitly on every `DialogContent` consumer; this pins it for the
  // one this issue was filed against.
  it("is announced as a modal dialog", () => {
    render(
      <SlashPalette
        open
        isModuleEnabled={() => true}
        status="ready"
        onSelect={noop}
        onOpenChange={noop}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });
});
