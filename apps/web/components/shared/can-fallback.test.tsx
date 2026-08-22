import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { activeChapter } = vi.hoisted(() => ({
  activeChapter: { value: "chapter-1" as string | null },
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId: activeChapter.value }),
}));

beforeEach(() => {
  activeChapter.value = "chapter-1";
  refetch.mockClear();
});

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

describe("a cached answer outlives the fetch that was refreshing it", () => {
  it("uses stale permissions when a background refetch fails outright", () => {
    // v5 keeps `data` through a background-refetch failure and only resets
    // `status` to `pending` when there is none, so `isError` and a usable
    // answer coexist. Denying there discards something we hold — the same
    // mistake as the paused branch, one status over. Found by this change's
    // own pre-push review, which refused the docstring until the code matched.
    renderGate({
      data: { permissions: ["polls:view_all"] },
      isPending: false,
      isError: true,
      fetchStatus: "idle",
    });
    expect(
      screen.getByRole("button", { name: /create poll/i }),
    ).toBeInTheDocument();
  });

  it("still fails closed when the fetch failed and there is nothing cached", () => {
    renderGate(
      { data: undefined, isPending: false, isError: true, fetchStatus: "idle" },
      { deniedFallback: <p>Ask your chapter president</p> },
    );
    expect(screen.queryByRole("button", { name: /create poll/i })).toBeNull();
    expect(screen.getByText(/ask your chapter president/i)).toBeInTheDocument();
  });
});

describe("the branches this change did not touch", () => {
  it("denies before it asks, when no chapter is selected", () => {
    activeChapter.value = null;
    renderGate(PAUSED, { deniedFallback: <p>Select a chapter</p> });
    // Above the paused branch on purpose: with no chapter there is no
    // permission context to be offline *about*, and the query is disabled
    // rather than paused.
    expect(screen.getByText(/select a chapter/i)).toBeInTheDocument();
    expect(screen.queryByText(/can't check your access/i)).toBeNull();
  });

  it("renders `deniedFallback` for a resolved answer that lacks the permission", () => {
    renderGate(
      {
        data: { permissions: ["polls:vote"] },
        isPending: false,
        isError: false,
        fetchStatus: "idle",
      },
      { deniedFallback: <p>Ask your chapter president</p> },
    );
    expect(screen.queryByRole("button", { name: /create poll/i })).toBeNull();
    expect(screen.getByText(/ask your chapter president/i)).toBeInTheDocument();
  });

  it("applies the same three branches to `anyOf` and `allOf`", () => {
    // `permission` is the only discriminator the rest of this file exercises,
    // and the paused branch sits above the verdict — so a mistake there would
    // be invisible on the other two shapes.
    const cached = {
      data: { permissions: ["chapter_docs:upload"] },
      isPending: false,
      isError: false,
      fetchStatus: "paused",
    };
    const upload = <button type="button">Upload</button>;

    permissionsResult.value = { ...PAUSED };
    const anyPaused = render(
      <Can anyOf={["chapter_docs:upload", "chapter_docs:manage"]}>{upload}</Can>,
    );
    expect(anyPaused.getByText(/can't check your access/i)).toBeInTheDocument();
    anyPaused.unmount();

    permissionsResult.value = cached;
    const anyCached = render(
      <Can anyOf={["chapter_docs:upload", "chapter_docs:manage"]}>{upload}</Can>,
    );
    expect(anyCached.getByRole("button", { name: /upload/i })).toBeInTheDocument();
    anyCached.unmount();

    permissionsResult.value = { ...PAUSED };
    const allPaused = render(<Can allOf={["chapter_docs:upload"]}>{upload}</Can>);
    expect(allPaused.getByText(/can't check your access/i)).toBeInTheDocument();
    allPaused.unmount();

    permissionsResult.value = cached;
    const allCached = render(<Can allOf={["chapter_docs:upload"]}>{upload}</Can>);
    expect(allCached.getByRole("button", { name: /upload/i })).toBeInTheDocument();
    allCached.unmount();
  });
});

/**
 * The gates that stand in for a whole screen or card, and therefore own their
 * own chrome.
 *
 * `<Can>` renders no container of its own, so the default `offlineFallback` is
 * the control-slot member of the §10 offline family — right for a gate
 * standing in for one button, wrong for a gate replacing a page or a card.
 * These eleven pass the card-shaped state instead. Listed rather than derived:
 * which of the two a gate is depends on what it wraps, which no grep decides.
 *
 * Three of them were missed on the first pass of this change and found by its
 * pre-push review — `invoice-admin-card` wraps the whole invoice surface,
 * `settings-page`'s rollover gate an entire `<Card>`, and `service-page`'s
 * approve gate the whole review queue. That is the argument for a ledger over
 * a heuristic: the mistake was in the classification, so the classification is
 * what has to be written down.
 */
const SURFACE_GATES: readonly { file: string; match: string }[] = [
  { file: "components/polls/polls-page.tsx", match: 'permission="polls:view_all"' },
  { file: "components/reports/reports-page.tsx", match: 'permission="reports:export"' },
  { file: "components/geofences/geofences-admin-page.tsx", match: 'permission="geofences:manage"' },
  { file: "components/roles/roles-page.tsx", match: 'permission="roles:manage"' },
  { file: "components/points/points-audit-card.tsx", match: 'permission="points:view_all"' },
  { file: "components/billing/invoice-admin-card.tsx", match: 'permission="billing:manage"' },
  { file: "components/settings/settings-page.tsx", match: 'permission="semester:rollover"' },
  { file: "components/service/service-page.tsx", match: 'permission="service:approve"' },
];

/**
 * Every file that mounts the gate. A ledger of names rather than a count,
 * because a count is satisfied by any fifteen files: the review of this change
 * renamed one import to `Can as Gate`, added an unrelated consumer to restore
 * the tally, and watched a `offlineFallback={null}` sail through green.
 */
const CONSUMERS: readonly string[] = [
  "components/backwork/backwork-page.tsx",
  "components/billing/invoice-admin-card.tsx",
  "components/billing/subscription-checkout-card.tsx",
  "components/chat/renderers/task-card.tsx",
  "components/documents/documents-page.tsx",
  "components/events/attendance-panel.tsx",
  "components/geofences/geofences-admin-page.tsx",
  "components/points/points-audit-card.tsx",
  "components/polls/polls-page.tsx",
  "components/reports/reports-page.tsx",
  "components/roles/roles-page.tsx",
  "components/service/service-page.tsx",
  "components/settings/settings-page.tsx",
  "components/shared/subscription-gate.tsx",
  "components/tasks/tasks-board.tsx",
];

const WEB_ROOT = join(__dirname, "..", "..");

/**
 * Comments are stripped before anything is matched.
 *
 * Two files discuss `<Can …>` in prose — `can.tsx`'s own usage example and
 * `subscription-gate.tsx`'s note about the recovery link — and a sweep that
 * counts those has a phantom gate it can never check, which is worse than
 * missing one: it reports coverage it does not have.
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The local name the file bound the import to — `Can`, or whatever it renamed it to. */
function localName(source: string): string | null {
  const clause = /import\s*\{([^}]*)\}\s*from\s*["']@\/components\/shared\/can["']/.exec(
    source,
  );
  if (!clause) return null;
  for (const spec of clause[1]!.split(",")) {
    const [imported, alias] = spec.split(/\s+as\s+/).map((part) => part.trim());
    if (imported === "Can") return alias ?? imported;
  }
  return null;
}

type Gate = { file: string; attrs: string; body: string };

/**
 * Every `<Can>` **element**, with its own attributes and its own children.
 *
 * Per element, not per file. The first cut of this guard asked whether the
 * *file* contained the string `offlineFallback=`, and the review defeated it
 * by deleting the prop from the real page gate and adding a decoy `<Can>`
 * carrying one — 9/9 green with the regression back in place.
 */
function gatesIn(file: string): Gate[] {
  const source = stripComments(readFileSync(join(WEB_ROOT, file), "utf8"));
  const name = localName(source);
  if (!name) return [];
  const gates: Gate[] = [];
  const open = new RegExp(`<${name}(?=[\\s/>])`, "g");
  let match: RegExpExecArray | null;
  while ((match = open.exec(source))) {
    // Walk to the `>` that closes the opening tag, ignoring the ones inside
    // JSX expression braces — `anyOf={[...]}` and every arrow-function
    // fallback in this tree contain `>` characters of their own.
    let depth = 0;
    let i = match.index + match[0].length;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    const attrs = source.slice(match.index + match[0].length, i);
    const close = source.indexOf(`</${name}>`, i);
    gates.push({
      file,
      attrs,
      body: close === -1 ? "" : source.slice(i + 1, close).trim(),
    });
  }
  return gates;
}

const ALL_GATES = CONSUMERS.flatMap(gatesIn);

describe("no call site can go blank again", () => {
  it("finds a gate in every consumer, so a rename cannot drop one out of the sweep", () => {
    for (const file of CONSUMERS) {
      expect(gatesIn(file).length, file).toBeGreaterThan(0);
    }
    expect(ALL_GATES.length).toBeGreaterThanOrEqual(CONSUMERS.length);
  });

  it("never passes `null` where the gate stands in for something actionable", () => {
    // `deniedFallback={null}` is fine and two sites write it: a denial is
    // permanent, and §5 rule 4 reserves hiding for exactly that. `fallback`
    // and `offlineFallback` are the recoverable ones.
    for (const gate of ALL_GATES) {
      expect(gate.attrs, gate.file).not.toMatch(/\bfallback=\{null\}/);
      if (isExplanatory(gate)) continue;
      expect(gate.attrs, `${gate.file} :: ${gate.attrs.trim()}`).not.toMatch(
        /\bofflineFallback=\{null\}/,
      );
    }
  });

  it("keeps the screen-level gates on the card-shaped offline state", () => {
    for (const { file, match } of SURFACE_GATES) {
      const gate = gatesIn(file).find((g) => g.attrs.includes(match));
      expect(gate, `${file} :: ${match}`).toBeDefined();
      expect(gate!.attrs, `${file} :: ${match}`).toContain("offlineFallback=");
      expect(gate!.attrs, `${file} :: ${match}`).toContain("OfflineState");
    }
  });

  it("silences exactly the gates whose child is a lone SubscriptionNotice", () => {
    // Derived, not listed. A gate wrapping only an explanation of *another*
    // control has no affordance to recover, so `null` is right there and only
    // there — and the rule runs both ways, so a fourth notice gate cannot ship
    // a chip and a fourth affordance cannot ship silence.
    const explanatory = ALL_GATES.filter(isExplanatory);
    expect(explanatory.length).toBe(3);
    for (const gate of explanatory) {
      expect(gate.attrs, gate.file).toMatch(/\bofflineFallback=\{null\}/);
    }
  });
});

/** A gate whose entire child is one `<SubscriptionNotice />`. */
function isExplanatory(gate: Gate): boolean {
  return /^<SubscriptionNotice\b[^>]*\/>$/.test(gate.body);
}
