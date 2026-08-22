import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Can } from "@/components/shared/can";

/**
 * The defect this file exists for.
 *
 * `can.tsx` gated fifteen surfaces on `isPending` alone and never read
 * `fetchStatus`. TanStack's default `networkMode` is `"online"`, so a member
 * who opened a gated route offline for the first time in a session got a
 * *paused* permissions query — `fetchStatus: "paused"`, `isPending: true` —
 * and the gate held its fallback until the network came back. Twelve of the
 * fifteen render nothing at all in that state (#1211).
 *
 * Two halves, because the regression has two shapes and one guard cannot see
 * both.
 *
 * The **behavioural** half pins the three branches, including the one that is
 * easiest to break while fixing this: a paused *refetch* over cached
 * permissions must still render children. `isPending` is already false there,
 * so it needs no branch — which is exactly why a later simplification to
 * `fetchStatus === "paused"` alone would compile, read correctly, and throw
 * away an answer we hold. That is the defect the Resources & Reporting slice
 * found twice on data queries; this stops it reaching the gate.
 *
 * The **source** half exists because #1211's twelve blank surfaces were
 * reached by *omitting* a prop, not by passing `null` — `fallback={null}` is
 * written literally nowhere in `apps/web`. A test that only renders `<Can>`
 * cannot see a call site that quietly stops passing what it used to. This is
 * the call-site guard the Resources & Reporting slice added after finding a
 * mapper-level invariant blind to an inline ternary, in the ledger shape
 * `apps/api/.../tenant-scope-coverage.spec.ts` uses: the entries are the
 * commitment, and a new gate that is *not* listed is fine, because the
 * component's own default covers it.
 */

const { permissionsResult } = vi.hoisted(() => ({
  permissionsResult: {
    value: {} as Record<string, unknown>,
  },
}));

const refetch = vi.fn();

vi.mock("@repo/hooks", () => ({
  useMyPermissions: () => ({ refetch, ...permissionsResult.value }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string | null }) => unknown) =>
    selector({ activeChapterId: "chapter-1" }),
}));

function renderGate(
  result: Record<string, unknown>,
  props: Record<string, unknown> = {},
) {
  permissionsResult.value = result;
  return render(
    <Can permission="polls:view_all" {...props}>
      <button type="button">Create poll</button>
    </Can>,
  );
}

const PAUSED = { data: undefined, isPending: true, isError: false, fetchStatus: "paused" };
const IDLE = { data: undefined, isPending: true, isError: false, fetchStatus: "idle" };
const LOADING = { data: undefined, isPending: true, isError: false, fetchStatus: "fetching" };

describe("a paused permission check is never silent", () => {
  it("would have caught the twelve surfaces that rendered nothing offline", () => {
    // No `fallback`, no `offlineFallback` — the exact shape of the twelve.
    renderGate(PAUSED);
    expect(screen.getByText(/can't check your access/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^retry$/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create poll/i })).toBeNull();
  });

  it("hands the gate's own retry to a caller that renders its own state", () => {
    // The recovery path is the *permission* query, which the call site does
    // not hold. A caller-supplied node with no way to re-arm would state the
    // problem and offer nothing, which is `writing.md` §1's dead end.
    renderGate(PAUSED, {
      offlineFallback: (retry: () => void) => (
        <button type="button" onClick={retry}>
          Reconnect
        </button>
      ),
    });
    screen.getByRole("button", { name: /reconnect/i }).click();
    expect(refetch).toHaveBeenCalled();
  });

  it("does not reach for the offline state on a paused refetch that has an answer", () => {
    // The half a "simplification" to `fetchStatus === 'paused'` would break.
    // README §4's rule is "offline, **no cached data**"; §10's is "background
    // refetches keep stale content in place". Both are this assertion.
    renderGate({
      data: { permissions: ["polls:view_all"] },
      isPending: false,
      isError: false,
      fetchStatus: "paused",
    });
    expect(
      screen.getByRole("button", { name: /create poll/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/can't check your access/i)).toBeNull();
  });
});

describe("the other two branches are unchanged, and still fail closed", () => {
  it("treats a disabled query as the entitlement branch, not as offline", () => {
    // §4 names this trap: swapping `isPending` for `isLoading` here renders
    // gated content to a viewer whose permissions were never fetched.
    renderGate(IDLE);
    expect(screen.queryByRole("button", { name: /create poll/i })).toBeNull();
    expect(screen.queryByText(/can't check your access/i)).toBeNull();
  });

  it("still renders `fallback` while the request is genuinely in flight", () => {
    renderGate(LOADING, { fallback: <p>Checking your chapter permissions</p> });
    expect(
      screen.getByText(/checking your chapter permissions/i),
    ).toBeInTheDocument();
  });

  it("tolerates a mock with no `fetchStatus` at all", () => {
    // Four suites in `components/chat/renderers/` stub `useMyPermissions`
    // without one. `undefined !== "paused"`, so they keep working — asserted
    // rather than assumed, because the alternative is four red files found by
    // someone else.
    renderGate({
      data: { permissions: ["polls:view_all"] },
      isPending: false,
      isError: false,
    });
    expect(
      screen.getByRole("button", { name: /create poll/i }),
    ).toBeInTheDocument();
  });
});

/**
 * The gates that stand in for a whole screen or card, and therefore own their
 * own chrome.
 *
 * `<Can>` renders no container of its own, so the default `offlineFallback` is
 * the control-slot member of the §10 offline family — right for the eighteen
 * sites that gate a single button, wrong for a gate replacing a page. These
 * five pass the card-shaped state instead. Listed rather than derived: which
 * of the two a gate is depends on what it wraps, which no grep can decide.
 */
const SURFACE_GATES = [
  "components/polls/polls-page.tsx",
  "components/reports/reports-page.tsx",
  "components/geofences/geofences-admin-page.tsx",
  "components/roles/roles-page.tsx",
  "components/points/points-audit-card.tsx",
] as const;

const WEB_ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : sourceFiles(full);
    }
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [full]
      : [];
  });
}

/** Every file that actually mounts the gate, `can.tsx` itself excluded. */
function gateCallSites(): { path: string; source: string }[] {
  return ["components", "app"]
    .flatMap((top) => sourceFiles(join(WEB_ROOT, top)))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter(
      ({ path, source }) =>
        !path.endsWith(join("shared", "can.tsx")) &&
        /<Can[\s\n>]/.test(source) &&
        source.includes('from "@/components/shared/can"'),
    );
}

describe("no call site can go blank again", () => {
  it("finds the gate's consumers, so an empty sweep cannot pass vacuously", () => {
    expect(gateCallSites().length).toBeGreaterThanOrEqual(15);
  });

  it("never passes `null` to either offline-capable fallback", () => {
    // `deniedFallback={null}` is fine and two sites write it: a denial is
    // permanent, and §5 rule 4 reserves hiding for exactly that. `fallback`
    // and `offlineFallback` are the recoverable ones.
    for (const { path, source } of gateCallSites()) {
      expect(source, path).not.toMatch(/\bfallback=\{null\}/);
      expect(source, path).not.toMatch(/\bofflineFallback=\{null\}/);
    }
  });

  it("keeps the screen-level gates on the card-shaped offline state", () => {
    for (const relative of SURFACE_GATES) {
      const source = readFileSync(join(WEB_ROOT, relative), "utf8");
      expect(source, relative).toContain("offlineFallback=");
    }
  });
});
