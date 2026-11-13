import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { TextInput } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * The member's Can't make it block on Event details: the chat card's button
 * arrives with `excuse=1`, which opens the line on arrival (#4660). The rule
 * itself is `myExcuseView`'s, run for real here.
 */

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMyEventExcuse: () => ({ data: { excuse: null, receiver: null } }),
  useMyAttendance: () => ({ data: { attendance: null } }),
  useSendEventExcuse: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useWithdrawEventExcuse: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: null }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import { MyExcuseCard } from "./event-excuses";

function render(startWriting?: boolean): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MyExcuseCard
          eventId="evt-1"
          required
          start="2026-11-15T23:00:00.000Z"
          end="2026-11-16T00:00:00.000Z"
          opensMinutes={10}
          now={new Date("2026-11-13T12:00:00.000Z")}
          startWriting={startWriting}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("MyExcuseCard", () => {
  it("opens the line on arrival from the chat card (#4660)", () => {
    expect(render(true).root.findAllByType(TextInput)).toHaveLength(1);
  });

  it("waits for Can't make it otherwise", () => {
    expect(render().root.findAllByType(TextInput)).toHaveLength(0);
  });
});
