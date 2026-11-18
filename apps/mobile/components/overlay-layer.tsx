import {
  createContext,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";

type Publish = (id: string, node: ReactNode | null) => void;

const OverlayLayerContext = createContext<Publish | null>(null);

/**
 * The app's overlay layer (`spec/ui/mobile/patterns.md` § Overlays): where an
 * overlay that has to cover the whole window, tab bar and open sheets
 * included, is drawn in the app's own view tree instead of a React Native
 * `Modal`. The glass item menu (`glass-menu.tsx`) is drawn here (#5517).
 *
 * It wraps the app and draws each overlay after it, as the last children, so
 * an overlay is on top in paint order and in hit-testing on both platforms
 * with no `zIndex`. While one is up, the app under it leaves the
 * accessibility tree (the wrapper is one native view, `collapsable={false}`,
 * so the toggle never re-parents the app).
 *
 * `ClientPolicyGate` mounts it inside the part of itself the update prompt
 * covers, so the prompt draws over every overlay here and the gate's
 * `pointerEvents="none"` reaches them too. That is why it lives there rather
 * than beside the sheet provider in `app/_layout.tsx`, a frozen file
 * (`spec/ui/mobile/navigation.md` § Hotspot freeze): the gate is the one
 * component above the sheet provider that isn't.
 */
export function OverlayLayer({ children }: { children: ReactNode }) {
  const [overlays, setOverlays] = useState<ReadonlyMap<string, ReactNode>>(
    () => new Map(),
  );
  const publish = useCallback<Publish>((id, node) => {
    setOverlays((current) => {
      if (node === null && !current.has(id)) return current;
      const next = new Map(current);
      // An update keeps its place: a Map holds insertion order.
      if (node === null) next.delete(id);
      else next.set(id, node);
      return next;
    });
  }, []);
  const up = overlays.size > 0;

  return (
    <OverlayLayerContext.Provider value={publish}>
      <View
        style={styles.fill}
        collapsable={false}
        accessibilityElementsHidden={up}
        importantForAccessibility={up ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {[...overlays].map(([id, node]) => (
        <Fragment key={id}>{node}</Fragment>
      ))}
    </OverlayLayerContext.Provider>
  );
}

/**
 * Draws `children` in the overlay layer for as long as it is mounted. Mount it
 * only while the overlay is up.
 *
 * What it draws renders under the layer's providers, not the screen's: the
 * app-wide ones above `ClientPolicyGate` (theme, safe area, the API client and
 * its queries) are there, a screen's own context and the sheet provider are
 * not, so pass what the overlay needs as props.
 *
 * With no layer above it (a spec that renders a screen alone), it draws in
 * place.
 */
export function InOverlayLayer({ children }: { children: ReactNode }) {
  const publish = useContext(OverlayLayerContext);
  const id = useId();
  // Layout effects, so the overlay is in the layer before the frame paints.
  useLayoutEffect(() => {
    publish?.(id, children);
  }, [publish, id, children]);
  useLayoutEffect(() => () => publish?.(id, null), [publish, id]);
  return publish ? null : <>{children}</>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
