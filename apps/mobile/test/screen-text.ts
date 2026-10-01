import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

/**
 * Everything a rendered screen says, as one string, so a check for text the
 * screen must never show is a substring test. Matching whole `Text` elements
 * would miss the text inside a longer sentence (`<Text>Details: {message}</Text>`),
 * and `String()` of a children array joins it with commas.
 *
 * Shared by the rendered subscription-refusal specs (#2416, #2410): each one's
 * "must not contain" checks are only as strong as this flattening, so it lives
 * in one place rather than drifting across copies.
 */
export const screenText = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType("Text" as never)
    .map((node) =>
      [node.props.children]
        .flat(Infinity)
        .filter((part) => typeof part === "string" || typeof part === "number")
        .join(""),
    )
    .join("\n");

/**
 * What one rendered element draws, the `Text`s nested inside it included, as
 * the string a reader sees. Reads the rendered tree rather than
 * `props.children`: a message body's children are markdown elements (#2861),
 * and `JSON.stringify` of an element walks its DEV-only `_owner` fiber, which
 * is circular.
 */
export const drawnText = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : drawnText(child)))
    .join("");

/**
 * The `Text`s a rendered screen marks as headings, which is where a screen
 * reader's headings rotor lands for its title. Only `Text`: a heading that is
 * also a control (Chat home's foldable section headers are `Pressable`s,
 * #2877) is not a title. Shared by the title specs (#2485) so that filter
 * can't drift between them.
 */
export const textHeadings = (tree: ReactTestRenderer): ReactTestInstance[] =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === "header" &&
      (node.type as unknown) === "Text",
  );
