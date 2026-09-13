import type { Metadata } from "next";

/**
 * A layout that exists only to carry the tab title.
 *
 * `/points` is the one real nav destination whose `page.tsx` is `"use client"`,
 * and a Client Component structurally cannot export `metadata`. Before lane 7
 * it fell through to the root layout's `"Signet Admin Dashboard"`; after the
 * title template landed it fell through to `default: "Signet"`, which put a
 * bare product name in the tab beside sixteen siblings reading `<Page> · Signet`
 * — and the same string the 404 shows, since `not-found.tsx` supports no
 * `metadata` export either.
 *
 * The three other metadata-less routes under `(dashboard)` need no equivalent:
 * `alumni`, `roles` and the group's own `page.tsx` are `redirect()` shims that
 * never paint a tab.
 *
 * A layout rather than converting the page to a Server Component wrapper: the
 * page is one client tree with its own state, and splitting it to move a string
 * would be a refactor in service of a title.
 */
export const metadata: Metadata = {
  title: "Points",
};

export default function PointsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
