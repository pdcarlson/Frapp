/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { StyleSheet } from "react-native";
import { memberAvatarTint } from "@repo/hooks";
import { MemberAvatar, photoCacheKey } from "./member-avatar";

/**
 * A member's avatar: their photo over their initials, the initials alone when
 * there is no photo or it fails to load, and a cache key that survives the
 * API re-signing the same photo.
 */

function render(uri: string | null) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <MemberAvatar
        uri={uri}
        initials="SK"
        size={32}
        style={{ width: 32, height: 32 }}
        textStyle={{}}
        testID="avatar"
      />,
    );
  });
  return tree;
}

const photos = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "ExpoImage");

describe("MemberAvatar", () => {
  it("draws the photo over the initials, cached by its storage path", () => {
    const tree = render("https://x.test/profiles/u/abc.jpg?token=one");
    const [photo] = photos(tree);
    expect(photo).toBeDefined();
    expect(photo!.props.source).toEqual({
      uri: "https://x.test/profiles/u/abc.jpg?token=one",
      cacheKey: "https://x.test/profiles/u/abc.jpg",
    });
    expect(photo!.props.cachePolicy).toBe("memory-disk");
    // The initials stay underneath, so a loading photo never shows a blank.
    expect(JSON.stringify(tree.toJSON())).toContain("SK");
  });

  it("draws initials alone without a photo", () => {
    const tree = render(null);
    expect(photos(tree)).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain("SK");
  });

  it("drops a photo that fails to load, and keeps it dropped across a re-sign", () => {
    const tree = render("https://x.test/p/abc.jpg?token=one");
    act(() => {
      photos(tree)[0]!.props.onError();
    });
    expect(photos(tree)).toHaveLength(0);
    act(() => {
      tree.update(
        <MemberAvatar
          uri="https://x.test/p/abc.jpg?token=two"
          initials="SK"
          size={32}
          style={{}}
          textStyle={{}}
        />,
      );
    });
    expect(photos(tree)).toHaveLength(0);
  });
});

// The host view that draws the circle, not the `MemberAvatar` element above it.
const circleOf = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) => node.props.testID === "avatar" && node.type !== MemberAvatar,
  );

describe("MemberAvatar tint (#3860)", () => {
  it("paints the circle's fill and the initials from the member's tint", () => {
    const tint = memberAvatarTint("#F2994A");
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <MemberAvatar
          uri={null}
          initials="SK"
          size={32}
          style={{ backgroundColor: "#1E1E1E" }}
          textStyle={{ color: "#A3A3A3" }}
          tint={tint}
          testID="avatar"
        />,
      );
    });
    const circle = circleOf(tree);
    expect(StyleSheet.flatten(circle.props.style).backgroundColor).toBe("#43362B");
    const text = tree.root.find(
      (node) => node.props.children === "SK" && node.props.style !== undefined,
    );
    expect(StyleSheet.flatten(text.props.style).color).toBe("#F2994A");
  });

  it("keeps the caller's neutral circle without a tint", () => {
    const tree = render(null);
    const circle = circleOf(tree);
    expect(StyleSheet.flatten(circle.props.style).backgroundColor).toBeUndefined();
  });
});

describe("photoCacheKey", () => {
  it("strips the signature", () => {
    expect(photoCacheKey("https://a/b.png?token=x&e=1")).toBe(
      "https://a/b.png",
    );
    expect(photoCacheKey("https://a/b.png")).toBe("https://a/b.png");
  });
});
