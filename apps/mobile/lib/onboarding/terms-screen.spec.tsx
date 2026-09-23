/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { TERMS_PROMPT_COPY } from "@repo/validation";

/**
 * #2302. A member who hasn't accepted the current Terms is pinned to this
 * screen (`resolveAuthGate` → `"terms"`, covered in `lib/auth-gate.spec.ts`).
 * These pin what the screen owes them: it records the acceptance only once the
 * box is ticked, says so when saving fails, and, because Settings is out of
 * reach while they're pinned here, still offers sign-out and account deletion
 * (Apple 5.1.1(v), as on the join screen).
 *
 * It renders `app/(auth)/terms.tsx` but lives here: a spec under `app/` ships
 * as a route module (`lib/routes.spec.ts`).
 */

const acceptMutateAsync = vi.fn();

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: "authenticated",
    signOut: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAcceptLegalTerms: () => ({
    isPending: false,
    isSuccess: false,
    mutateAsync: acceptMutateAsync,
  }),
  useDeleteAccount: () => ({
    isPending: false,
    isSuccess: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));

import TermsPrompt from "@/app/(auth)/terms";

type Node = ReactTestRenderer["root"];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <TermsPrompt />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/** The pressable whose rendered text includes `label` (see join-screen.spec). */
function control(root: Node, label: string) {
  return root
    .findAllByType("Pressable" as never, { deep: true })
    .find((pressable) =>
      pressable
        .findAllByType("Text" as never, { deep: true })
        .some((text) =>
          JSON.stringify(text.props.children ?? "").includes(label),
        ),
    );
}

const checkbox = (root: Node) =>
  root
    .findAllByType("Pressable" as never, { deep: true })
    .find((pressable) => pressable.props.accessibilityRole === "checkbox");

const texts = (root: Node) =>
  root
    .findAllByType("Text" as never, { deep: true })
    .map((text) => JSON.stringify(text.props.children ?? ""));

describe("Terms prompt (#2302)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acceptMutateAsync.mockResolvedValue({ required: false });
  });

  it("offers sign-out and account deletion beside the agreement", () => {
    const tree = render();
    expect(checkbox(tree.root)).toBeDefined();
    expect(control(tree.root, TERMS_PROMPT_COPY.cta)).toBeDefined();
    expect(control(tree.root, "Sign out")).toBeDefined();
    expect(control(tree.root, "Delete account")).toBeDefined();
  });

  it("records nothing until the box is ticked", async () => {
    const tree = render();

    await act(async () => {
      await control(tree.root, TERMS_PROMPT_COPY.cta)?.props.onPress();
    });

    expect(acceptMutateAsync).not.toHaveBeenCalled();
    expect(
      texts(tree.root).some((t) => t.includes(TERMS_PROMPT_COPY.unticked)),
    ).toBe(true);
  });

  it("records the acceptance once the box is ticked", async () => {
    const tree = render();

    act(() => {
      checkbox(tree.root)?.props.onPress();
    });
    await act(async () => {
      await control(tree.root, TERMS_PROMPT_COPY.cta)?.props.onPress();
    });

    expect(acceptMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("says so when the acceptance couldn't be saved", async () => {
    acceptMutateAsync.mockRejectedValueOnce({ statusCode: 500 });
    const tree = render();

    act(() => {
      checkbox(tree.root)?.props.onPress();
    });
    await act(async () => {
      await control(tree.root, TERMS_PROMPT_COPY.cta)?.props.onPress();
    });

    expect(
      texts(tree.root).some((t) => t.includes("Couldn't save your agreement")),
    ).toBe(true);
  });
});
