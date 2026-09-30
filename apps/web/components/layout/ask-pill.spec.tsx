import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The Ask dialog offers Documents only where the chapter has it (#1982).
 *
 * Documents can be switched off per chapter. Offering it anyway sends a member
 * to a screen whose reads the API refuses. The gate is the same member-readable
 * one the sidebar uses, and before #1982 it came from a config read every
 * member below President fails, so it never gated at all.
 */

const { gate } = vi.hoisted(() => ({
  gate: { current: undefined as ((key: string) => boolean) | undefined },
}));

vi.mock("@/lib/hooks/use-chapter-module-gate", () => ({
  useChapterModuleGate: () => gate.current,
}));

const { AskPill } = await import("./ask-pill");

async function openAsk() {
  render(<AskPill />);
  await userEvent.setup().click(
    screen.getByRole("button", { name: /ask a question/i }),
  );
}

describe("AskPill", () => {
  it("points at Documents while the chapter has it on", async () => {
    gate.current = () => true;
    await openAsk();
    expect(screen.getByRole("link", { name: "Open Documents" })).toHaveAttribute(
      "href",
      "/documents",
    );
  });

  it("does not point at Documents the chapter switched off", async () => {
    gate.current = (key) => key !== "documents";
    await openAsk();
    expect(screen.queryByRole("link", { name: "Open Documents" })).toBeNull();
    expect(screen.queryByText(/live under Documents/)).toBeNull();
  });

  it("keeps Documents while the chapter read is in flight, so nothing flashes out", async () => {
    gate.current = undefined;
    await openAsk();
    expect(screen.getByRole("link", { name: "Open Documents" })).toBeInTheDocument();
  });
});
