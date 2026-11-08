/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
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

describe("photoCacheKey", () => {
  it("strips the signature", () => {
    expect(photoCacheKey("https://a/b.png?token=x&e=1")).toBe(
      "https://a/b.png",
    );
    expect(photoCacheKey("https://a/b.png")).toBe("https://a/b.png");
  });
});
