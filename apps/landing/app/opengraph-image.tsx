import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export const alt = "Signet. Ask your chapter anything.";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

/**
 * Social preview card (Open Graph / Twitter). Locked emblem B from
 * Design's raster, not the reconstructed crest SVG.
 */
export default async function OpenGraphImage() {
  const emblem = await fetch(
    new URL("./opengraph-emblem.png", import.meta.url),
  ).then((res) => res.arrayBuffer());

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
