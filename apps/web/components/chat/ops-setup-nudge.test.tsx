import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const dismissMutate = vi.fn();

let chapters: { data: unknown } = { data: [] };
let orgConfig: { data: unknown } = { data: undefined };
let permissions: { data: unknown } = { data: undefined };

let dismissPending = false;

vi.mock("@repo/hooks", () => ({
  useAccessibleChapters: () => chapters,
  useOrgConfig: () => orgConfig,
  useMyPermissions: () => permissions,
  useDismissOpsNudge: () => ({
    mutate: dismissMutate,
    isPending: dismissPending,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chapter-1" }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import { OpsSetupNudge, OpsSetupNudgeCard } from "./ops-setup-nudge";
import { MODULE_CATALOG } from "@repo/org-archetypes";
import { OPS_NUDGE_MODULES } from "@repo/validation";

/** The officer case: can manage config, dues switched off, nothing dismissed. */
function setUpEligible(
  overrides: {
    enabledModules?: Record<string, boolean>;
    dismissed?: string[];
    permissions?: string[];
  } = {},
) {
  chapters = {
    data: [
      {
        chapter_id: "chapter-1",
        dismissed_ops_nudges: overrides.dismissed ?? [],
      },
    ],
  };
  orgConfig = {
    data: { enabled_modules: overrides.enabledModules ?? { dues: false } },
  };
  permissions = {
    data: {
      permissions: overrides.permissions ?? [
        "chapter-config:manage",
        "members:view",
      ],
    },
  };
}

/**
 * The ops-module setup nudge on chat home (#492).
 *
 * What is pinned here is the set of ways this card can be wrong in a way no
 * type catches: showing to someone who cannot act on it, showing two at once,
 * showing for a chapter that never turned anything off, and promising a trial
 * that does not exist.
 */
describe("OpsSetupNudge", () => {
  beforeEach(() => {
    dismissMutate.mockClear();
    dismissPending = false;
    setUpEligible();
  });

  it("offers the highest-priority disabled module to an officer", () => {
    setUpEligible({ enabledModules: { dues: false, points: false } });
    render(<OpsSetupNudge />);

    expect(screen.getByText(/collect dues in frapp/i)).toBeInTheDocument();
    // One at a time — the Points nudge must not also be on screen.
    expect(screen.queryByText(/participation points/i)).not.toBeInTheDocument();
  });

  it("links to the Modules tab targeting the module it names", () => {
    render(<OpsSetupNudge />);

    // `?module=` is what lands the officer on the row rather than at the top
    // of the list; losing it silently degrades the click to a generic jump.
    expect(screen.getByRole("link", { name: /enable dues/i })).toHaveAttribute(
      "href",
      "/settings?tab=modules&module=dues",
    );
  });

  // AC 4, first half. Settings → Modules gates its switches on this same
  // permission, so nudging anyone else offers a card whose only working
  // control is Dismiss.
  it("renders nothing for a member without chapter-config:manage", () => {
    setUpEligible({ permissions: ["members:view"] });
    const { container } = render(<OpsSetupNudge />);
    expect(container).toBeEmptyDOMElement();
  });

  // The client gate must match what the SERVER requires, not just what the
  // destination control requires. `MemberController` carries a class-level
  // `members:view` that `PermissionsGuard` unions into every route, so a custom
  // role with settings access but no roster access would get a 403 on dismiss —
  // and `onError` is a deliberate no-op, so the card would be undismissable
  // forever. No seeded role has that shape; custom roles are a shipped feature.
  it("renders nothing for a member who could not dismiss it server-side", () => {
    setUpEligible({ permissions: ["chapter-config:manage"] });
    const { container } = render(<OpsSetupNudge />);
    expect(container).toBeEmptyDOMElement();
  });

  // AC 4, second half — and the subtle one. A module with no entry in
  // `enabled_modules` is ENABLED under the repo-wide "enabled unless explicitly
  // false" contract, so a chapter that never customised its archetype must see
  // nothing at all.
  it("renders nothing when no targeted module is explicitly disabled", () => {
    setUpEligible({ enabledModules: { dues: true, hours: false } });
    const { container } = render(<OpsSetupNudge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the chapter config is still resolving", () => {
    setUpEligible();
    orgConfig = { data: undefined };
    const { container } = render(<OpsSetupNudge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("respects a dismissal already recorded on the member row", () => {
    setUpEligible({
      enabledModules: { dues: false, events: false },
      dismissed: ["dues"],
    });
    render(<OpsSetupNudge />);

    // Falls through to the next in priority order rather than going silent.
    expect(screen.getByText(/run your calendar in frapp/i)).toBeInTheDocument();
  });

  it("writes the dismissal and hides the card without waiting for the server", async () => {
    const user = userEvent.setup();
    render(<OpsSetupNudge />);

    await user.click(
      screen.getByRole("button", { name: /dismiss the dues suggestion/i }),
    );

    expect(dismissMutate).toHaveBeenCalledWith(
      { module_key: "dues" },
      expect.anything(),
    );
    // The card is gone on the optimistic local state — `GET /v1/chapters` has
    // not refetched, so a card that waited for it would sit under the cursor.
    expect(screen.queryByText(/collect dues in frapp/i)).not.toBeInTheDocument();
  });

  it("falls through to the next nudge after one is dismissed in-session", async () => {
    const user = userEvent.setup();
    setUpEligible({ enabledModules: { dues: false, tasks: false } });
    render(<OpsSetupNudge />);

    await user.click(
      screen.getByRole("button", { name: /dismiss the dues suggestion/i }),
    );

    expect(screen.getByText(/assign chapter tasks/i)).toBeInTheDocument();
  });

  // Each dismiss button must be distinguishable by name alone: a screen-reader
  // user meeting the second of four "Dismiss" buttons over a chapter's life has
  // no way to tell which suggestion they just closed.
  it("names the dismiss control after the module it closes", () => {
    setUpEligible({ enabledModules: { tasks: false } });
    render(<OpsSetupNudge />);

    expect(
      screen.getByRole("button", { name: /dismiss the tasks suggestion/i }),
    ).toBeInTheDocument();
  });

  // Not a live region. The nudge is standing advice that is equally true on the
  // member's tenth visit; announcing it would talk over what they opened chat
  // to read. `offline-banner.tsx` is the contrasting case and takes role=alert.
  it("is a region rather than an alert", () => {
    render(<OpsSetupNudge />);

    const card = screen.getByRole("region", {
      name: /collect dues in frapp/i,
    });
    expect(card).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // #485 is open, so per-module trials do not exist, and the chapter-level
  // trial is once per chapter — a returning chapter gets none. Copy that
  // promised one would be false on both counts.
  it("promises no trial", () => {
    render(<OpsSetupNudge />);
    expect(screen.queryByText(/trial/i)).not.toBeInTheDocument();
  });
});

/**
 * The card on its own, with no queries and no store — which is the reason it is
 * exported separately. Without these, that export has no second call site and a
 * prop change would be caught by nothing.
 */
describe("OpsSetupNudgeCard", () => {
  const duesNudge = OPS_NUDGE_MODULES.find((m) => m.key === "dues")!;

  it("renders from a nudge alone", () => {
    render(<OpsSetupNudgeCard module={duesNudge} onDismiss={vi.fn()} />);
    expect(screen.getByText(/collect dues in frapp/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /enable dues/i })).toBeInTheDocument();
  });

  it("hands the dismissed module key back to its caller", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<OpsSetupNudgeCard module={duesNudge} onDismiss={onDismiss} />);

    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(onDismiss).toHaveBeenCalledWith("dues");
  });
});

/**
 * The nudge catalog carries keys and pitch copy; the module's *name* belongs to
 * `MODULE_CATALOG`. Nothing else ties the two together, and both failure modes
 * are silent: a relabel would leave the card saying "Enable Dues" while every
 * other surface said something new, and a key rename would make `?module=` match
 * no row, quietly degrading the deep link to a plain Modules tab — the exact
 * thing `?module=` exists to prevent.
 */
describe("nudge keys against MODULE_CATALOG", () => {
  it("every nudge key resolves to a real catalog entry", () => {
    const catalogKeys = new Set(MODULE_CATALOG.map((m) => m.key));
    for (const nudge of OPS_NUDGE_MODULES) {
      expect(catalogKeys.has(nudge.key)).toBe(true);
    }
  });

  // Enabling is what the nudge asks for, so a free or always-on module here
  // would be a card offering a switch that does not exist.
  it("every nudge key names a toggleable paid module", () => {
    for (const nudge of OPS_NUDGE_MODULES) {
      const entry = MODULE_CATALOG.find((m) => m.key === nudge.key)!;
      expect(entry.alwaysOn).toBe(false);
      expect(entry.tier).toBe("paid");
    }
  });
});

/**
 * Dismissing falls the next nudge through immediately, so a fresh dismiss
 * control lands under the cursor in the same spot. The server appends to
 * `dismissed_ops_nudges` read-modify-write, so two overlapping writes would each
 * read the pre-write array and the later one would erase the earlier key.
 */
describe("OpsSetupNudge concurrent dismissals", () => {
  beforeEach(() => {
    dismissMutate.mockClear();
    dismissPending = false;
  });

  it("blocks a second dismissal while the first is still in flight", () => {
    dismissPending = true;
    setUpEligible({ enabledModules: { dues: false, events: false } });
    render(<OpsSetupNudge />);

    expect(
      screen.getByRole("button", { name: /dismiss the dues suggestion/i }),
    ).toBeDisabled();
  });

  it("leaves the control usable when nothing is in flight", () => {
    setUpEligible({ enabledModules: { dues: false } });
    render(<OpsSetupNudge />);

    expect(
      screen.getByRole("button", { name: /dismiss the dues suggestion/i }),
    ).toBeEnabled();
  });
});
