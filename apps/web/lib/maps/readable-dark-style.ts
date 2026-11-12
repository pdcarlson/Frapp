import type {
  LayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";

/**
 * OpenFreeMap's `dark` style, re-inked so an officer can find a building on
 * it without leaning in.
 *
 * As served, the style is a near-black poster: buildings (rgb 10) are darker
 * than the ground (rgb 12), minor roads sit 12 steps above it, labels are
 * rgb 80 to 101, and it has no place names below the city. Picking a study
 * zone means finding one building on a campus, so this follows what Google
 * Maps and Apple Maps do in dark mode instead: ground darkest, buildings a
 * clear step lighter with an edge, roads lighter again by importance, water
 * and green space faintly tinted, and building and place names (the library,
 * the union) in readable gray.
 *
 * Colors are paint overrides keyed by the style's layer ids. A layer id that
 * stops existing upstream is skipped, so an OpenFreeMap update degrades to
 * the stock look instead of breaking the map.
 */

/** Ground, buildings, roads: each step lighter than the one under it. */
const INK = {
  ground: "#141517",
  residential: "#17181b",
  green: "#17221b",
  water: "#16212e",
  building: "#2b2d32",
  buildingEdge: "#4a4d55",
  path: "#30333a",
  minor: "#3a3d44",
  majorCasing: "#5c5f68",
  major: "#4b4e56",
  motorwayCasing: "#6b6e77",
  motorway: "#575a63",
  rail: "#3a3d44",
  roadLabel: "#b4b7bf",
  placeLabel: "#a3a6ae",
  poiLabel: "#d3d5db",
  halo: "#141517",
} as const;

type Paint = Record<string, unknown>;

const PAINT: Record<string, Paint> = {
  background: { "background-color": INK.ground },
  water: { "fill-color": INK.water },
  waterway: { "line-color": INK.water },
  water_name: {
    "text-color": "#6f8296",
    "text-halo-color": INK.halo,
  },
  landuse_residential: {
    "fill-color": INK.residential,
    "fill-opacity": 1,
  },
  landuse_park: { "fill-color": INK.green },
  landcover_wood: { "fill-color": INK.green },
  building: {
    "fill-color": INK.building,
    "fill-outline-color": INK.buildingEdge,
  },
  road_area_pier: { "fill-color": INK.ground },
  road_pier: { "line-color": INK.ground },
  highway_path: { "line-color": INK.path, "line-opacity": 1 },
  highway_minor: { "line-color": INK.minor, "line-opacity": 1 },
  highway_major_casing: { "line-color": INK.majorCasing },
  highway_major_inner: { "line-color": INK.major },
  highway_major_subtle: { "line-color": INK.major },
  highway_motorway_casing: { "line-color": INK.motorwayCasing },
  highway_motorway_inner: {
    "line-color": [
      "interpolate",
      ["linear"],
      ["zoom"],
      5.8,
      "hsla(0,0%,85%,0.53)",
      6,
      INK.motorway,
    ],
  },
  highway_motorway_subtle: { "line-color": INK.motorway },
  railway: { "line-color": INK.rail },
  railway_minor: { "line-color": INK.rail },
  railway_transit: { "line-color": INK.rail },
  railway_dashline: { "line-color": INK.ground },
  railway_minor_dashline: { "line-color": INK.ground },
  railway_transit_dashline: { "line-color": INK.ground },
  highway_name_other: {
    "text-color": INK.roadLabel,
    "text-halo-color": INK.halo,
    "text-halo-width": 1.5,
  },
  highway_name_motorway: {
    "text-color": INK.roadLabel,
    "text-halo-color": INK.halo,
    "text-halo-width": 1.5,
  },
};

const PLACE_LABEL: Paint = {
  "text-color": INK.placeLabel,
  "text-halo-color": INK.halo,
  "text-halo-width": 1.5,
  "text-halo-blur": 0,
};

const POI_LAYER_ID = "poi_name";

/**
 * Names of buildings and places (a library, a dining hall, a quad), from the
 * same tiles. The stock dark style draws none. Text only, no icons: the
 * sprite's icons are drawn for a light map.
 */
const POI_LAYER: SymbolLayerSpecification = {
  id: POI_LAYER_ID,
  type: "symbol",
  source: "openmaptiles",
  "source-layer": "poi",
  minzoom: 15,
  filter: [
    "all",
    ["match", ["geometry-type"], ["MultiPoint", "Point"], true, false],
    ["has", "name"],
    // Busier places appear first, quieter ones as the officer zooms in.
    ["<=", ["get", "rank"], ["step", ["zoom"], 6, 16, 20, 17, 1000]],
  ],
  layout: {
    "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
    "text-font": ["Noto Sans Regular"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 15, 11, 18, 13],
    "text-max-width": 8,
    "text-padding": 4,
  },
  paint: {
    "text-color": INK.poiLabel,
    "text-halo-color": INK.halo,
    "text-halo-width": 1.5,
  },
};

function withPaint(layer: LayerSpecification): LayerSpecification {
  if (layer.type === "symbol" && layer.id.startsWith("place_")) {
    return { ...layer, paint: { ...layer.paint, ...PLACE_LABEL } };
  }
  const paint = PAINT[layer.id];
  if (!paint) return layer;
  // The overrides are written against the stock layer types; the cast is the
  // one place that trusts the id to still name a layer of the same type.
  return {
    ...layer,
    paint: { ...(layer as { paint?: Paint }).paint, ...paint },
  } as LayerSpecification;
}

export function readableDarkStyle(
  style: StyleSpecification,
): StyleSpecification {
  const layers = style.layers.map(withPaint);
  if (
    style.sources.openmaptiles &&
    !layers.some((layer) => layer.id === POI_LAYER_ID)
  ) {
    // Under road and place names, so a street name wins a collision.
    const at = layers.findIndex((layer) => layer.id === "highway_name_other");
    layers.splice(at === -1 ? layers.length : at, 0, POI_LAYER);
  }
  return { ...style, layers };
}
