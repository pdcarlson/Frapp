/** @vitest-environment jsdom */
import { describe, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * The Log hours sheet's host contract. The sheet's own rules, from the
 * Service page, are `lib/more/service-hours-screen.spec.tsx`'s.
 */

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCreateServiceEntry: () => ({ mutate: vi.fn(), isPending: false }),
  useRequestServiceProofUploadUrl: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: null }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import { LogHoursSheet } from "./log-hours-sheet";
import { expectHostDismissGuarded } from "@/test/wedging-sheet";

describe("LogHoursSheet — dismissed by its host while closed (#5059)", () => {
  it("never reaches the modal unless it is up, so it still opens", () => {
    expectHostDismissGuarded((ref) => (
      <FrappThemeProvider>
        <LogHoursSheet ref={ref} now={new Date("2026-09-27T12:00:00Z")} />
      </FrappThemeProvider>
    ));
  });
});
