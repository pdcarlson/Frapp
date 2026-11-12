import { useCallback, useState } from "react";

/**
 * When a form shows a field's error: the one rule for web and mobile
 * (`spec/ui/design-system/components.md` § Text input, "When an error shows").
 *
 * A field's error stays hidden while the member is still typing it. It shows
 * once they leave the field (blur) or try to submit, and from then on it
 * follows what they type, so fixing the value clears it at once. Until then a
 * half-typed value ("20" on the way to "2027") is a draft, not a mistake, and
 * painting it red is the form shouting at someone mid-word.
 *
 * The form still computes validity on every render. This decides only whether
 * the member sees it, so a disabled or refusing submit can stay exact.
 */
export type FieldReveal<Field extends string> = {
  /** Whether `field`'s error, if it has one, is shown now. */
  shows: (field: Field) => boolean;
  /** The member left `field`: its error shows from now on. */
  blur: (field: Field) => void;
  /** The member tried to submit: every field's error shows from now on. */
  submit: () => void;
  /** Back to nothing shown, for a form that closes or resets. */
  reset: () => void;
};

type RevealState<Field extends string> = {
  submitted: boolean;
  left: ReadonlySet<Field>;
};

const EMPTY: RevealState<never> = { submitted: false, left: new Set() };

/** The pure step behind {@link useFieldReveal}, exported for its tests. */
function revealAfterBlur<Field extends string>(
  state: RevealState<Field>,
  field: Field,
): RevealState<Field> {
  if (state.left.has(field)) return state;
  return { ...state, left: new Set([...state.left, field]) };
}

/** Whether `field`'s error shows in `state`. */
function revealShows<Field extends string>(
  state: RevealState<Field>,
  field: Field,
): boolean {
  return state.submitted || state.left.has(field);
}

export function useFieldReveal<Field extends string>(): FieldReveal<Field> {
  const [state, setState] = useState<RevealState<Field>>(EMPTY);

  const blur = useCallback(
    (field: Field) => setState((current) => revealAfterBlur(current, field)),
    [],
  );
  const submit = useCallback(
    () =>
      setState((current) =>
        current.submitted ? current : { ...current, submitted: true },
      ),
    [],
  );
  const reset = useCallback(() => setState(EMPTY), []);
  const shows = useCallback(
    (field: Field) => revealShows(state, field),
    [state],
  );

  return { shows, blur, submit, reset };
}
