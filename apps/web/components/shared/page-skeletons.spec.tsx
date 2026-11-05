import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PageSkeleton,
  SkeletonControl,
  SkeletonRows,
} from "@/components/shared/page-skeletons";

const WEB = join(__dirname, "..", "..");
const DASHBOARD = join(WEB, "app", "(dashboard)");

describe("PageSkeleton", () => {
  it("announces the load once, on a line of its own", () => {
    render(<PageSkeleton label="Loading service hours" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading service hours");
    expect(status).toHaveClass("sr-only");
  });

  it("draws no title: the top bar already carries it", () => {
    render(<PageSkeleton label="Loading tasks" />);

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("does not mark real content it renders as busy", () => {
    render(
      <PageSkeleton label="Loading billing">
        <h2>Plans</h2>
      </PageSkeleton>,
    );

    expect(screen.getByRole("heading", { name: "Plans" })).toBeVisible();
    expect(document.querySelector("[aria-busy]")).toBeNull();
  });

  it("draws an action row only when given actions", () => {
    const { container, rerender } = render(
      <PageSkeleton label="Loading events" />,
    );
    expect(container.querySelector(".justify-end")).toBeNull();

    rerender(
      <PageSkeleton
        label="Loading events"
        actions={<SkeletonControl className="w-24" />}
      />,
    );
    expect(container.querySelector(".justify-end")).not.toBeNull();
  });

  it("draws no card chrome around the page", () => {
    const { container } = render(
      <PageSkeleton label="Loading tasks">
        <SkeletonRows rows={2} />
      </PageSkeleton>,
    );

    // The defect this module replaces: a `--card` box on a flush page.
    expect(container.querySelector(".bg-card")).toBeNull();
    expect(container.querySelector(".rounded-xl")).toBeNull();
  });
});

describe("SkeletonRows", () => {
  it("draws the requested rows on the dense list's hairlines", () => {
    const { container } = render(<SkeletonRows rows={3} />);
    const list = container.querySelector("ul");

    expect(list).toHaveClass("divide-y", "border-t");
    expect(list?.querySelectorAll("li")).toHaveLength(3);
  });

  it("clamps a runaway count instead of throwing", () => {
    const { container } = render(<SkeletonRows rows={Infinity} />);

    expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(24);
  });

  it("draws a checkbox lead as the real checkbox's square, not a dot", () => {
    const { container } = render(<SkeletonRows rows={1} lead="checkbox" />);

    expect(container.querySelector("li > div")).toHaveClass(
      "h-6",
      "w-6",
      "rounded-[7px]",
    );
  });
});

function walk(dir: string, match: (file: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, match);
    return match(path) ? [path] : [];
  });
}

describe("route loaders", () => {
  /*
   * Without its own `loading.tsx`, a route falls back to the dashboard-wide
   * one, which knows nothing about the page it stands in for. That fallback
   * used to be the only loader, and it is what drew a generic card on every
   * route. A new route ships its own, mirroring its layout.
   */
  const pages = walk(DASHBOARD, (file) => file.endsWith("page.tsx"));
  const routes = pages
    .filter((page) => !/\bredirect\(/.test(readFileSync(page, "utf8")))
    .map((page) => relative(DASHBOARD, join(page, "..")));

  it("finds the routes it is guarding", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it.each(routes)("/%s has its own loading.tsx", (route) => {
    expect(existsSync(join(DASHBOARD, route, "loading.tsx"))).toBe(true);
  });
});

describe("generic loading states", () => {
  /*
   * `LoadingState` and `NestedLoading` are a caption over bars: the right
   * answer only where nothing about the loaded layout is known (a mutation in
   * flight, a palette's async list). Everywhere a page or a region has a
   * known shape, its skeleton mirrors it. This list holds the places that
   * still use them and only shrinks: a new use is a new skeleton to draw.
   */
  const ALLOWED = new Set([
    // Mutations in flight: the result's shape is not known yet.
    "components/discord-import/connect-step.tsx",
    "components/reports/reports-page.tsx",
    // Small regions inside a loaded card; mirrored shapes tracked in #3503.
    "components/chat/slash-palette.tsx",
    "components/discord-import/import-watch-panel.tsx",
    "components/events/attendance-panel.tsx",
    "components/points/points-audit-card.tsx",
    "components/profile/blocked-members-card.tsx",
    "components/profile/discord-history-card.tsx",
  ]);

  const users = [
    ...walk(join(WEB, "components"), (file) => file.endsWith(".tsx")),
    ...walk(join(WEB, "app"), (file) => file.endsWith(".tsx")),
  ]
    .filter((file) => !file.endsWith(".spec.tsx"))
    .filter((file) =>
      /<(LoadingState|NestedLoading)\b/.test(readFileSync(file, "utf8")),
    )
    .map((file) => relative(WEB, file))
    .filter(
      (file) =>
        file !== "components/shared/async-states.tsx" &&
        file !== "components/shared/nested-states.tsx",
    );

  it("are used only where the allowlist says", () => {
    expect(users.filter((file) => !ALLOWED.has(file))).toEqual([]);
  });

  it("keeps the allowlist free of files that no longer need it", () => {
    expect([...ALLOWED].filter((file) => !users.includes(file))).toEqual([]);
  });
});
