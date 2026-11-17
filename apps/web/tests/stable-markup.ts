/**
 * An element's markup as one line per element, for specs that pin a
 * component's rendered DOM compactly enough to read in a diff.
 *
 * Generated ids go: Radix and cmdk draw `useId` values (`radix-_r_3_`) into
 * `id`, `for`, `aria-controls`, `aria-labelledby` and the like, and those move
 * whenever an unrelated hook is added, so a pin that kept them would fail for
 * reasons that change nothing anyone sees. An icon's inner paths go too
 * (lucide owns them); its tag and classes stay.
 */
export function markupLines(element: Element, depth = 0): string[] {
  const attributes = Array.from(element.attributes)
    .filter(
      (attribute) =>
        !/^radix-|:r[0-9a-z]+:|_r_[0-9a-z]+_/.test(attribute.value),
    )
    .filter(
      (attribute) =>
        element.tagName !== "svg" ||
        ["class", "aria-hidden"].includes(attribute.name),
    )
    .map((attribute) => `${attribute.name}="${attribute.value}"`)
    .sort();
  const text = Array.from(element.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
  const line = `${"  ".repeat(depth)}<${element.tagName.toLowerCase()}${attributes.map((a) => ` ${a}`).join("")}>${text}`;
  if (element.tagName === "svg") return [line];
  return [
    line,
    ...Array.from(element.children).flatMap((child) =>
      markupLines(child, depth + 1),
    ),
  ];
}
