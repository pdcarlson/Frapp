import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { StyleSheet, View } from "react-native";
import { DropBoundary } from "@/components/drop-boundary";

/** One overlay in the layer: what it draws, and how it is dropped on a throw. */
interface Entry {
  node: ReactNode;
  onError?: () => void;
}

/**
 * The overlays up right now. The layer subscribes to the list of ids, which
 * changes only when one opens or closes; each slot subscribes to its own
 * entry, which changes whenever the screen that owns it renders.
 */
function createOverlayStore() {
  const entries = new Map<string, Entry>();
  let ids: readonly string[] = [];
  const idListeners = new Set<() => void>();
  const entryListeners = new Map<string, Set<() => void>>();

  const subscribe = (set: Set<() => void>, listener: () => void) => {
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };

  return {
    ids: () => ids,
    entry: (id: string) => entries.get(id),
    subscribeIds: (listener: () => void) => subscribe(idListeners, listener),
    subscribeEntry: (id: string, listener: () => void) => {
      let set = entryListeners.get(id);
      if (!set) {
        set = new Set();
        entryListeners.set(id, set);
      }
      return subscribe(set, listener);
    },
    set(id: string, entry: Entry) {
      const added = !entries.has(id);
      entries.set(id, entry);
      if (added) {
        ids = [...entries.keys()];
        idListeners.forEach((listener) => listener());
      } else {
        entryListeners.get(id)?.forEach((listener) => listener());
      }
    },
    remove(id: string) {
      if (!entries.delete(id)) return;
      entryListeners.delete(id);
      ids = [...entries.keys()];
      idListeners.forEach((listener) => listener());
    },
  };
}

type OverlayStore = ReturnType<typeof createOverlayStore>;

const OverlayLayerContext = createContext<OverlayStore | null>(null);

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
 * so the toggle never re-parents the app). Each overlay sits in its own error
 * boundary, so one that throws is reported (`error_boundary: overlay`) and
 * dropped, and the app under it stays.
 *
 * `ClientPolicyGate` mounts it inside the view its update prompt covers. That
 * view is the only place that puts every overlay under the prompt, both in
 * paint order and in the `pointerEvents="none"` that blocks the app, so the
 * gate, and not the root layout, is where it lives.
 */
export function OverlayLayer({ children }: { children: ReactNode }) {
  const [store] = useState(createOverlayStore);
  const ids = useSyncExternalStore(store.subscribeIds, store.ids);
  const up = ids.length > 0;

  return (
    <OverlayLayerContext.Provider value={store}>
      <View
        style={styles.fill}
        collapsable={false}
        accessibilityElementsHidden={up}
        importantForAccessibility={up ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {ids.map((id) => (
        <OverlaySlot key={id} id={id} store={store} />
      ))}
    </OverlayLayerContext.Provider>
  );
}

function OverlaySlot({ id, store }: { id: string; store: OverlayStore }) {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeEntry(id, listener),
    [store, id],
  );
  const entry = useSyncExternalStore(subscribe, () => store.entry(id));
  if (!entry) return null;
  return (
    <DropBoundary
      boundary="overlay"
      // Read at the throw, so a screen's newer close is the one called.
      onError={() => store.entry(id)?.onError?.()}
    >
      {entry.node}
    </DropBoundary>
  );
}

/**
 * Draws `children` in the overlay layer for as long as it is mounted. Mount it
 * only while the overlay is up. `onError` runs if what it draws throws, after
 * the layer has dropped it: close the overlay there, so nothing (a back
 * handler) stays held for an overlay no one can see.
 *
 * What it draws renders under the layer's providers, not the screen's: the
 * app-wide ones above `ClientPolicyGate` (theme, safe area, the API client and
 * its queries) are there, a screen's own context and the sheet provider are
 * not, so pass what the overlay needs as props.
 *
 * Each render of the owning screen hands the layer its new `children`, so an
 * open overlay keeps up with the screen. React Native has no portal, so that
 * takes a second commit; it is the slot's alone (the layer, and the app it
 * wraps, re-render only when an overlay opens or closes), synchronous before
 * the frame paints, and the body still renders once per screen render, since
 * the screen's own commit draws nothing here.
 *
 * With no layer above it (a spec that renders a screen alone), it draws in
 * place.
 */
export function InOverlayLayer({
  children,
  onError,
}: {
  children: ReactNode;
  onError?: () => void;
}) {
  const store = useContext(OverlayLayerContext);
  const id = useId();
  useLayoutEffect(() => {
    store?.set(id, { node: children, onError });
  }, [store, id, children, onError]);
  useLayoutEffect(() => () => store?.remove(id), [store, id]);
  return store ? null : <>{children}</>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
