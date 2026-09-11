import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export const alt = "Signet. Ask your chapter anything.";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

/**
 * Social preview card (Open Graph / Twitter). Locked emblem B, synced from
 * the canonical 1024² raster that `rasterize:brand-assets` renders from
 * `signet-emblem-B.svg` — a raster here because Satori cannot lay out an
 * external SVG, not because the vector is the lesser source (#2153).
 */
export default async function OpenGraphImage() {
  const emblemBytes = await readFile(
    join(process.cwd(), "app/opengraph-emblem.png"),
  );
  const emblem = `data:image/png;base64,${emblemBytes.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1A1A1A",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 28,
        }}
      >
        <img
          src={emblem}
          width={120}
          height={120}
          style={{ borderRadius: 28 }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 96,
              fontWeight: 800,
              color: "#DDB844",
              letterSpacing: "-0.04em",
            }}
          >
            Signet
          </span>
          <span
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: "#A89B7A",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Ask your chapter anything.
          </span>
        </div>
      </div>
    </div>,
    {
      ...size,
    },
  );
}
