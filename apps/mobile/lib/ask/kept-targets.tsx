import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * The members an officer left on each points card, by proposal. Held with
 * the conversation, not by the card: a card unmounts when its sheet closes or
 * its row scrolls away, and a list that quietly went back to the first one
 * would give points to someone the officer had taken off.
 */
export type KeptTargets = Readonly<Record<string, readonly string[]>>;

interface AskKept {
  kept: KeptTargets;
  keep: (suggestionId: string, targets: readonly string[]) => void;
  /** Forgets every list, as New conversation does. */
  forget: () => void;
}

const AskKeptContext = createContext<AskKept | null>(null);

const NONE: KeptTargets = {};

/**
 * Holds the kept lists for everything under it, beside the conversation they
 * belong to (`ask-conversation.tsx`). `scope` is whose they are: when it
 * changes they are dropped during render, so no frame shows one account's
 * lists under another.
 */
export function AskKeptProvider({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  const [held, setHeld] = useState<{ scope: string; kept: KeptTargets }>({
    scope,
    kept: NONE,
  });
  const kept = held.scope === scope ? held.kept : NONE;
  const keep = useCallback(
    (suggestionId: string, targets: readonly string[]) =>
      setHeld((current) => ({
        scope,
        kept: {
          ...(current.scope === scope ? current.kept : NONE),
          [suggestionId]: targets,
        },
      })),
    [scope],
  );
  const forget = useCallback(() => setHeld({ scope, kept: NONE }), [scope]);
  const value = useMemo(() => ({ kept, keep, forget }), [kept, keep, forget]);
  return (
    <AskKeptContext.Provider value={value}>{children}</AskKeptContext.Provider>
  );
}

/**
 * The lists kept on points cards, shared by every place a card is drawn: the
 * Ask sheet, and a channel the member asked `@Frapp` from (#4713). With no
 * provider above it (a screen rendered alone), the caller's own.
 */
export function useAskKept(): AskKept {
  const shared = useContext(AskKeptContext);
  const [own, setOwn] = useState<KeptTargets>(NONE);
  const keep = useCallback(
    (suggestionId: string, targets: readonly string[]) =>
      setOwn((current) => ({ ...current, [suggestionId]: targets })),
    [],
  );
  const forget = useCallback(() => setOwn(NONE), []);
  const local = useMemo(
    () => ({ kept: own, keep, forget }),
    [own, keep, forget],
  );
  return shared ?? local;
}
