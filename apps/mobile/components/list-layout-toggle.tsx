import { View } from "react-native";
import { Segmented } from "@/components/segmented";
import {
  setListLayout,
  useListLayout,
  type ListLayout,
  type ListLayoutScreen,
} from "@/lib/list-layout";

const OPTIONS = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
] as const satisfies readonly { value: ListLayout; label: string }[];

/** Wide enough for both words at the caption role, narrow enough for a title row. */
const TOGGLE_WIDTH = 128;

/**
 * The one List/Grid switch every screen that offers both uses (#4175): a
 * § Segmented control with word labels, as the Events tab's List/Calendar is,
 * sized to sit at the trailing end of a screen's title row. The pick is
 * remembered per screen on this phone (`lib/list-layout.ts`).
 */
export function ListLayoutToggle({ screen }: { screen: ListLayoutScreen }) {
  const layout = useListLayout(screen);
  return (
    <View style={{ width: TOGGLE_WIDTH }}>
      <Segmented
        options={OPTIONS}
        value={layout}
        onChange={(next) => setListLayout(screen, next)}
        accessibilityLabel="Layout"
      />
    </View>
  );
}
