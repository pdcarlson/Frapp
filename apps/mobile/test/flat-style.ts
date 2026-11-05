/**
 * A rendered element's `style` prop as one object, the way React Native would
 * apply it: a `({ pressed }) => style` function (a `Pressable`'s) is called
 * with `pressed` first, then arrays are merged left to right, nested ones
 * included, and `null`/`false` entries drop out.
 *
 * The shared copy: a new spec reads styles through this. Older specs still
 * carry private copies, which are moving here (#3441). A flattener that skips
 * the function step hands back the function itself, cast as a style, so a
 * check like `expect(flatStyle(row.props.style).opacity).toBeUndefined()`
 * passes whatever the row draws.
 */
export function flatStyle(
  style: unknown,
  pressed = false,
): Record<string, unknown> {
  if (typeof style === "function") {
    return flatStyle(style({ pressed }), pressed);
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((item) => flatStyle(item, pressed)));
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}
