/**
 * Where the study zone map gets its tiles and its place search.
 *
 * Both are free public services that need no account and no key, so the map
 * costs nothing and Paul has nothing to set up:
 *
 * - **Tiles: OpenFreeMap** (`tiles.openfreemap.org`), vector tiles built from
 *   OpenStreetMap, no limits on views or requests, commercial use allowed, a
 *   dark style that sits on Signet's near-black. Rendered with MapLibre GL JS.
 * - **Search: Photon** (`photon.komoot.io`), OpenStreetMap search made for
 *   search-as-you-type. Nominatim, the other free one, forbids autocomplete.
 *
 * Neither has a service level. Zones are drawn a few times a term per chapter,
 * so the volume is tiny, but if either goes away or throttles, this file is
 * the whole swap: a MapTiler or Mapbox style URL and its geocoder (both have
 * free tiers far above this volume, and need a key in Infisical).
 */

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

const SEARCH_URL = "https://photon.komoot.io/api/";

/** A search slower than this is treated as down: the map still works. */
const SEARCH_TIMEOUT_MS = 6000;

export type PlaceResult = {
  id: string;
  /** The place's own name: "Folsom Library". */
  name: string;
  /** Where it is, for telling two of the same name apart: "Troy, New York". */
  detail: string;
  lat: number;
  lng: number;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    country?: string;
  };
};

/** One Photon feature as a result row, or nothing when it has no point. */
export function toPlaceResult(feature: PhotonFeature): PlaceResult | null {
  const [lng, lat] = feature.geometry?.coordinates ?? [];
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const p = feature.properties ?? {};
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const name = p.name ?? street;
  if (!name) return null;
  const detail = [p.name ? street : "", p.city, p.state]
    .filter(Boolean)
    .join(", ");
  return {
    id: `${p.osm_type ?? "x"}${p.osm_id ?? `${lat},${lng}`}`,
    name,
    detail,
    lat,
    lng,
  };
}

/**
 * Places matching what the officer typed, nearest `near` first when given
 * (the zones the chapter already has, or its campus), so "library" finds the
 * one on campus rather than one across the country.
 */
export async function searchPlaces(
  query: string,
  options: { near?: { lat: number; lng: number }; signal?: AbortSignal } = {},
): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ q, limit: "6", lang: "en" });
  if (options.near) {
    params.set("lat", String(options.near.lat));
    params.set("lon", String(options.near.lng));
  }
  // The caller's signal or the timeout, whichever comes first. Built by hand:
  // `AbortSignal.any` is newer than the Safari versions Next still targets.
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, SEARCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${SEARCH_URL}?${params}`, {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
  if (!response.ok) throw new Error(`Place search failed (${response.status})`);
  const body = (await response.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  const results: PlaceResult[] = [];
  for (const feature of body.features ?? []) {
    const place = toPlaceResult(feature);
    if (!place || seen.has(place.id)) continue;
    seen.add(place.id);
    results.push(place);
  }
  return results;
}
