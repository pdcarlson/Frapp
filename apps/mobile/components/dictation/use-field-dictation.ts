import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDictation,
  type UseDictationOptions,
} from "@/lib/dictation/use-dictation";
import { joinDictated } from "./dictation-controls";

/**
 * Dictation into one text field (#5276 Ask, #5772 chat): the room the field
 * has left, the words joined onto what the field holds when they land, and
 * the Original chip's state. Ask's sheet and every phone chat composer use
 * this, so the two can't drift.
 *
 * - `max`: the field's own limit. `cap`: a smaller limit on one go, where the
 *   field is bigger than what the cleanup takes (chat's 10,000-character
 *   message against the 1,000 a dictation can be tidied).
 * - `target`: what the words are for, such as a channel and whether a reply
 *   or edit is open. When it changes, a dictation in progress is dropped and
 *   the Original chip goes, so words heard for one draft never land in
 *   another.
 * - The chip also goes as soon as the field holds anything other than the
 *   tidied words: typing, a send, a scheduled send, or the parent swapping
 *   the text in.
 */
export function useFieldDictation({
  value,
  setValue,
  max,
  cap,
  clean,
  target = null,
}: {
  value: string;
  setValue: (next: string) => void;
  max: number;
  cap?: number;
  clean: UseDictationOptions["clean"];
  target?: string | null;
}) {
  const valueRef = useRef(value);
  const targetRef = useRef(target);
  useEffect(() => {
    valueRef.current = value;
    targetRef.current = target;
  }, [value, target]);
  const [landed, setOriginal] = useState<{
    tidied: string;
    restore: string;
    target: string | null;
  } | null>(null);
  // The chip shows only while the field still holds the tidied words, for
  // the same target.
  const original =
    landed !== null && landed.tidied === value && landed.target === target
      ? landed
      : null;
  // With a space before the new words.
  const roomLeft = max - (value.trim() ? value.trimEnd().length + 1 : 0);
  const capBinds = cap !== undefined && cap < roomLeft;
  // Which limit the try started under, for the `full` notice's wording.
  const [fullBy, setFullBy] = useState<"field" | "cap">("field");
  const dictation = useDictation({
    clean,
    room: capBinds ? cap : roomLeft,
    onText: (text, heard) => {
      const before = valueRef.current;
      const tidied = joinDictated(before, text, max);
      const restore = joinDictated(before, heard, max);
      setValue(tidied);
      setOriginal(
        tidied === restore
          ? null
          : { tidied, restore, target: targetRef.current },
      );
    },
  });

  const cancel = dictation.cancel;
  const lastTarget = useRef(target);
  useEffect(() => {
    if (lastTarget.current === target) return;
    lastTarget.current = target;
    cancel();
  }, [target, cancel]);

  const dictationStart = dictation.start;
  const start = useCallback(() => {
    setOriginal(null);
    setFullBy(capBinds ? "cap" : "field");
    dictationStart();
  }, [capBinds, dictationStart]);

  const restoreOriginal = useCallback(() => {
    if (original === null) return;
    setValue(original.restore);
    setOriginal(null);
  }, [original, setValue]);

  return {
    dictation,
    start,
    roomLeft,
    fullBy,
    original,
    restoreOriginal,
    clearOriginal: useCallback(() => setOriginal(null), []),
  };
}
