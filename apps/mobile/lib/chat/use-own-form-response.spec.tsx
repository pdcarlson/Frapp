/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOwnFormResponse } from "./use-own-form-response";

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return { ...actual, useFrappClient: () => ({}) };
});

const reads = vi.hoisted(() => ({
  count: 0,
  next: null as null | ((value: unknown) => void),
}));
vi.mock("@repo/chat-core/forms", async () => {
  const actual = await vi.importActual<typeof import("@repo/chat-core/forms")>(
    "@repo/chat-core/forms",
  );
  return {
    ...actual,
    fetchOwnFormResponse: () => {
      reads.count += 1;
      return new Promise((resolve) => {
        reads.next = resolve;
      });
    },
  };
});

const ANSWERS = { answers: { q1: "Sam" }, updated_at: "x" };

function Reader({ readOnOpen }: { readOnOpen?: boolean }) {
  useOwnFormResponse("m1", true, readOnOpen);
  return null;
}

function mount(client: QueryClient, node: React.ReactNode) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  reads.count = 0;
  reads.next = null;
});

describe("useOwnFormResponse (#4752)", () => {
  it("reads again on the form page's open even when the card's copy is fresh", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["chat", "form-response", "m1"], ANSWERS);
    // The card, inside its 60s staleTime: no read.
    mount(client, <Reader />);
    expect(reads.count).toBe(0);
    // The page: exactly one.
    mount(client, <Reader readOnOpen />);
    expect(reads.count).toBe(1);
  });

  it("joins a read the card already has in flight rather than sending a second", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mount(client, <Reader />);
    expect(reads.count).toBe(1);
    mount(client, <Reader readOnOpen />);
    expect(reads.count).toBe(1);
  });
});
