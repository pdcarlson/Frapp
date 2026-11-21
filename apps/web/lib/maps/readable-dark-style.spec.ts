import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { readableDarkStyle } from "@/lib/maps/readable-dark-style";

/** The stock layers this cares about, trimmed to what it reads. */
function stockStyle(): StyleSpecification {
  return {
    version: 8,
    sources: { openmaptiles: { type: "vector", url: "https://x/planet" } },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "rgb(12,12,12)" },
      },
      {
        id: "building",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        paint: { "fill-antialias": true, "fill-color": "rgb(10,10,10)" },
      },
      {
        id: "highway_name_other",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        paint: { "text-color": "rgba(80, 78, 78, 1)" },
      },
      {
        id: "place_city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        paint: { "text-color": "rgb(101,101,101)" },
      },
      {
        id: "highway_path",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        paint: { "line-color": "rgb(27 ,27 ,29)" },
      },
      {
        id: "highway_minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        paint: { "line-color": "#181818" },
      },
      {
        id: "highway_major_inner",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        paint: { "line-color": "hsl(0,0%,7%)" },
      },
      {
        id: "landcover_wood",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        paint: {
          "fill-color": "rgb(32,32,32)",
          "fill-pattern": "wood-pattern",
        },
      },
      {
        id: "something_new",
        type: "background",
        paint: { "background-color": "red" },
      },
    ],
  };
}

function layer(style: StyleSpecification, id: string) {
  return style.layers.find((l) => l.id === id) as
    (LayerSpecification & { paint?: Record<string, unknown> }) | undefined;
}

/** Relative luminance of a #rrggbb color, 0 to 1. */
function luminance(hex: unknown): number {
  const value = String(hex);
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

describe("readableDarkStyle", () => {
  it("draws buildings lighter than the ground, with an edge", () => {
    const style = readableDarkStyle(stockStyle());
    const ground = layer(style, "background")?.paint?.["background-color"];
    const building = layer(style, "building")?.paint;
    expect(luminance(building?.["fill-color"])).toBeGreaterThan(
      luminance(ground) * 1.5,
    );
    expect(building?.["fill-outline-color"]).toBeDefined();
    // Keeps the stock paint it doesn't override.
    expect(building?.["fill-antialias"]).toBe(true);
  });

  it("brightens road and place names", () => {
    const style = readableDarkStyle(stockStyle());
    for (const id of ["highway_name_other", "place_city"]) {
      expect(
        luminance(layer(style, id)?.paint?.["text-color"]),
      ).toBeGreaterThan(0.3);
    }
  });

  it("adds building and place names under the road names, once", () => {
    const once = readableDarkStyle(stockStyle());
    const twice = readableDarkStyle(once);
    const ids = twice.layers.map((l) => l.id);
    expect(ids.filter((id) => id === "poi_name")).toHaveLength(1);
    expect(ids.indexOf("poi_name")).toBe(ids.indexOf("highway_name_other") - 1);
  });

  it("leaves layers it doesn't know as they are", () => {
    const style = readableDarkStyle(stockStyle());
    expect(layer(style, "something_new")?.paint).toEqual({
      "background-color": "red",
    });
  });

  it("steps roads up from the ground: paths, then minor, then major", () => {
    const style = readableDarkStyle(stockStyle());
    const ground = luminance(
      layer(style, "background")?.paint?.["background-color"],
    );
    const [path, minor, major] = [
      "highway_path",
      "highway_minor",
      "highway_major_inner",
    ].map((id) => luminance(layer(style, id)?.paint?.["line-color"]));
    expect(path).toBeGreaterThan(ground * 1.5);
    expect(minor).toBeGreaterThan(path!);
    expect(major).toBeGreaterThan(minor!);
  });

  it("tints woods instead of drawing the light map's wood pattern", () => {
    const paint = layer(
      readableDarkStyle(stockStyle()),
      "landcover_wood",
    )?.paint;
    expect(paint?.["fill-pattern"]).toBeUndefined();
    expect(paint?.["fill-color"]).toMatch(/^#/);
  });

  it("leaves a layer stock when upstream changes its type", () => {
    const stock = stockStyle();
    stock.layers = stock.layers.map((l) =>
      l.id === "building"
        ? {
            id: "building",
            type: "fill-extrusion",
            source: "openmaptiles",
            "source-layer": "building",
            paint: { "fill-extrusion-color": "#111" },
          }
        : l,
    );
    expect(layer(readableDarkStyle(stock), "building")?.paint).toEqual({
      "fill-extrusion-color": "#111",
    });
  });

  it("adds no names layer to a style without OpenFreeMap's source", () => {
    const stock = stockStyle();
    stock.sources = { composite: { type: "vector", url: "https://x/y" } };
    const ids = readableDarkStyle(stock).layers.map((l) => l.id);
    expect(ids).not.toContain("poi_name");
  });

  it("does not change the style it was given", () => {
    const stock = stockStyle();
    readableDarkStyle(stock);
    expect(stock).toEqual(stockStyle());
  });
});
