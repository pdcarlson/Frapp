import { useEffect, type RefObject } from "react";

/**
 * A textarea that grows with what is typed. `field-sizing: content` does
 * that where the browser has it (put `[field-sizing:content]` on the field);
 * elsewhere (Firefox, older Safari) the height is set from the text, or a
 * long entry would be read one line at a time through a scrollbar.
 */
export function useGrowWithText(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  active = true,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    if (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content"))
      return;
    element.style.height = "auto";
    if (element.scrollHeight > 0)
      element.style.height = `${element.scrollHeight}px`;
  }, [ref, value, active]);
}
