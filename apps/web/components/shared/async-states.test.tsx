import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { LoadingState, EmptyState, ErrorState, OfflineState } from "./async-states";

describe("Async States Components", () => {
  describe("LoadingState", () => {
    it("renders with default message", () => {
      render(<LoadingState />);
      expect(screen.getByText("Loading data...")).toBeInTheDocument();
    });

    it("renders with custom message", () => {
      render(<LoadingState message="Fetching users..." />);
      expect(screen.getByText("Fetching users...")).toBeInTheDocument();
    });
  });

  describe("EmptyState", () => {
    it("renders title and description", () => {
      render(
        <EmptyState title="No items found" description="Try adjusting your filters" />
      );
      expect(screen.getByRole("heading", { name: "No items found" })).toBeInTheDocument();
      expect(screen.getByText("Try adjusting your filters")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("renders action button and triggers onAction", async () => {
      const handleAction = vi.fn();
      render(
        <EmptyState
          title="No items found"
          description="Try adjusting your filters"
          actionLabel="Clear Filters"
          onAction={handleAction}
        />
      );

      const button = screen.getByRole("button", { name: "Clear Filters" });
      expect(button).toBeInTheDocument();

      await userEvent.click(button);
      expect(handleAction).toHaveBeenCalledTimes(1);
    });

    it("does not render action button if actionLabel is provided without onAction", () => {
      render(
        <EmptyState
          title="No items found"
          description="Try adjusting your filters"
          actionLabel="Clear Filters"
        />
      );

      expect(screen.queryByRole("button", { name: "Clear Filters" })).not.toBeInTheDocument();
    });

     it("does not render action button if onAction is provided without actionLabel", () => {
      const handleAction = vi.fn();
      render(
        <EmptyState
          title="No items found"
          description="Try adjusting your filters"
          onAction={handleAction}
        />
      );

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("ErrorState", () => {
    it("renders with default title and description", () => {
      render(<ErrorState />);
      expect(screen.getByRole("heading", { name: "Unable to load data" })).toBeInTheDocument();
      expect(screen.getByText("Please retry in a moment.")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("renders with custom title and description", () => {
      render(<ErrorState title="Database Error" description="Connection failed." />);
      expect(screen.getByRole("heading", { name: "Database Error" })).toBeInTheDocument();
      expect(screen.getByText("Connection failed.")).toBeInTheDocument();
    });

    it("renders retry button and triggers onRetry", async () => {
      const handleRetry = vi.fn();
      render(<ErrorState onRetry={handleRetry} />);

      const button = screen.getByRole("button", { name: "Retry" });
      expect(button).toBeInTheDocument();

      await userEvent.click(button);
      expect(handleRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("OfflineState", () => {
    it("renders with default props", () => {
      render(<OfflineState />);
      expect(screen.getByRole("heading", { name: "You're offline" })).toBeInTheDocument();
      expect(
        screen.getByText("Reconnect to sync chapter data and retry this workflow.")
      ).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("renders with custom title and description", () => {
      render(
        <OfflineState
          title="No internet connection"
          description="Please check your network settings."
        />
      );
      expect(screen.getByRole("heading", { name: "No internet connection" })).toBeInTheDocument();
      expect(screen.getByText("Please check your network settings.")).toBeInTheDocument();
    });

    it("renders retry button with custom label and triggers onRetry", async () => {
      const handleRetry = vi.fn();
      render(<OfflineState actionLabel="Try connecting" onRetry={handleRetry} />);

      const button = screen.getByRole("button", { name: "Try connecting" });
      expect(button).toBeInTheDocument();

      await userEvent.click(button);
      expect(handleRetry).toHaveBeenCalledTimes(1);
    });
  });
});
