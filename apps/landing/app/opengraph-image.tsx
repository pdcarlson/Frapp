import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Frapp — The Operating System for Greek Life";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

/**
 * Social preview card (Open Graph / Twitter). Keeps palette aligned with app icon:
 * navy field, sky accent — no missing static /og-image.png.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0F172A",
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
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 28,
              backgroundColor: "#0F172A",
              border: "4px solid #60A5FA",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#60A5FA",
              fontSize: 72,
              fontWeight: 800,
            }}
          >
            F
          </div>
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
                color: "#60A5FA",
                letterSpacing: "-0.04em",
              }}
            >
              frapp
            </span>
            <span
              style={{
                fontSize: 28,
                fontWeight: 600,
                color: "#94A3B8",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              The operating system for Greek life
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
