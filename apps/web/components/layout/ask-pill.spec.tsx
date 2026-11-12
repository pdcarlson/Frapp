import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The Ask popover offers Documents only where the chapter has it (#1982).
 *
 * Documents can be switched off per chapter. Offering it anyway sends a member
 * to a screen whose reads the API refuses. The gate is the same member-readable
 * one the sidebar uses, and before #1982 it came from a config read every
 * member below President fails, so it never gated at all.
 */

const { gate, hidden, setupArgs, ai } = vi.hoisted(() => ({
  ai: {
    // `null`: the server has no AI. An object: the AI sheet, so it does.
    consent: null as object | null | undefined,
    settings: undefined as { ask: boolean } | undefined,
    permissions: ["members:view"] as string[],
  },
  gate: { current: undefined as ((key: string) => boolean) | undefined },
  hidden: { current: new Set<string>() },
  setupArgs: [] as unknown[][],
}));

vi.mock("@repo/hooks", () => ({
  useMyPermissions: () => ({ data: { permissions: ai.permissions } }),
  useAiConsent: () => ({ data: ai.consent }),
  aiAvailableFrom: (query: { data: unknown }) =>
    query.data === undefined ? undefined : query.data !== null,
  useAiChapterSettings: () => ({
    data: ai.settings,
    isPending: ai.settings === undefined,
  }),
  // The rule itself is pinned in `@repo/hooks` (`unset-features.spec.tsx`).
  useHiddenUnsetFeatures: (...args: unknown[]) => {
    setupArgs.push(args);
    return hidden.current;
  },
}));

vi.mock("@/lib/hooks/use-chapter-module-gate", () => ({
  useChapterModuleGate: () => gate.current,
}));

vi.mock("@/components/ask/ask-panel", () => ({
  AskPanel: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Ask Frapp" /> : null,
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
    expect(screen.queryByText(/live in Documents/)).toBeNull();
  });

  it("keeps Documents while the chapter read is in flight, so nothing flashes out", async () => {
    gate.current = undefined;
    await openAsk();
    expect(screen.getByRole("link", { name: "Open Documents" })).toBeInTheDocument();
  });

  it("does not point at Documents nobody has uploaded to, for a member who can't", async () => {
    gate.current = () => true;
    hidden.current = new Set(["documents"]);
    try {
      await openAsk();
      expect(
        screen.queryByRole("link", { name: "Open Documents" }),
      ).not.toBeInTheDocument();
      expect(setupArgs.at(-1)?.[0]).toEqual(["members:view"]);
      expect(setupArgs.at(-1)?.[1]).toBe(gate.current);
    } finally {
      hidden.current = new Set();
      gate.current = undefined;
    }
  });
});

/**
 * With AI on (#450) the pill is the way into the Ask panel, for a chapter
 * whose president has Ask on and a member who may use AI. Otherwise there is
 * no pill: nothing it could open.
 */
describe("AskPill with AI on the server", () => {
  const withAi = (
    settings: { ask: boolean } | undefined,
    permissions: string[] = ["ai:use"],
  ) => {
    ai.consent = { sheet: {} };
    ai.settings = settings;
    ai.permissions = permissions;
  };
  const reset = () => {
    ai.consent = null;
    ai.settings = undefined;
    ai.permissions = ["members:view"];
  };

  it("opens the Ask panel, and closes it on a second press", async () => {
    withAi({ ask: true });
    try {
      render(<AskPill />);
      const pill = screen.getByRole("button", { name: /ask a question/i });
      const user = userEvent.setup();
      await user.click(pill);
      expect(screen.getByRole("dialog", { name: "Ask Frapp" })).toBeInTheDocument();
      expect(screen.queryByText(/isn't ready yet/i)).toBeNull();
      expect(pill).toHaveAttribute("aria-expanded", "true");
      await user.click(pill);
      expect(screen.queryByRole("dialog", { name: "Ask Frapp" })).toBeNull();
    } finally {
      reset();
    }
  });

  it("shows no pill while the president has Ask off", () => {
    withAi({ ask: false });
    try {
      render(<AskPill />);
      expect(screen.queryByRole("button", { name: /ask a question/i })).toBeNull();
    } finally {
      reset();
    }
  });

  it("shows no pill to a member who may not use AI", () => {
    withAi({ ask: true }, ["members:view"]);
    try {
      render(<AskPill />);
      expect(screen.queryByRole("button", { name: /ask a question/i })).toBeNull();
    } finally {
      reset();
    }
  });

  it("holds the pill's place, empty, while the chapter's switches load", () => {
    withAi(undefined);
    try {
      const { container } = render(<AskPill />);
      // Nothing to press or read yet, and nothing saying "not ready".
      expect(screen.queryByRole("button", { name: /ask a question/i })).toBeNull();
      expect(container.querySelector("button.invisible")).toBeDisabled();
    } finally {
      reset();
    }
  });

  it("holds the pill's place while the server has not said whether it has AI", () => {
    ai.consent = undefined;
    try {
      const { container } = render(<AskPill />);
      expect(container.querySelector("button.invisible")).toBeInTheDocument();
    } finally {
      reset();
    }
  });
});
