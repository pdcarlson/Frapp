import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Signet — Ask your chapter anything.";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

/**
 * Social preview card (Open Graph / Twitter). Locked emblem B: gold crest on
 * charcoal — no missing static /og-image.png.
 */
export default function OpenGraphImage() {
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
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 28,
            backgroundColor: "#1A1A1A",
            border: "4px solid #DDB844",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="88"
            height="88"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fill="#DDB844"
              d="M22.2 32.4c.2-8.2 7.8-15.2 18.2-14.2 6.6.7 12.4 5.6 13.8 12.2 1 4.8-.6 9.2-4.8 12.2-2.2 1.6-4.8 2.5-7.6 2.6l-1.2 7.4c-.4 2.2 1.2 4.2 3.4 4.4l.6-4.2c2.8.1 5.6-.6 8-2.2 5.8-4.2 8.2-11.2 6.8-18.2C57.2 19.4 48.2 12.2 38.2 11.2 24.4 9.8 14.8 19.4 14.6 31.4c-.1 5.4 2.6 10.2 7.2 13.2l2.2-3.4c-2.8-2.2-4.6-5.6-4.4-8.8z"
            />
            <rect
              x="24.5"
              y="45.2"
              width="12.5"
              height="2.6"
              rx="1.1"
              fill="#1A1A1A"
              transform="rotate(-32 31 46.5)"
            />
          </svg>
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
