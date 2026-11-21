"use client";

import { SegmentedChoice } from "@/components/ui/segmented";
import {
  useListLayout,
  type ListLayout,
  type ListLayoutScreen,
} from "@/lib/list-layout";

const OPTIONS = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
] as const satisfies readonly { value: ListLayout; label: string }[];

/**
 * The one List/Grid switch every screen that offers both uses (#4175), as
 * the Events page's List/Calendar is drawn: a § Segmented control with word
 * labels, not a pair of icons, so the two toggles on the dashboard read alike
 * (`spec/ui/design-system/components.md` § Segmented control). The pick is
 * remembered per person and per screen (`lib/list-layout.ts`).
 */
export function ListLayoutToggle({
  screen,
  className,
}: {
  screen: ListLayoutScreen;
  className?: string;
}) {
  const [layout, setLayout] = useListLayout(screen);
  return (
    <SegmentedChoice
      label="Layout"
      options={OPTIONS}
      value={layout}
      onChange={setLayout}
      className={className}
    />
  );
}
