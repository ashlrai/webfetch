import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "webfetch — the license-first image layer for AI agents and humans";

const STAMPS: Array<{ label: string; kind: "pd" | "cc" | "cc-sa" | "ed" }> = [
  { label: "CC0", kind: "pd" },
  { label: "PD", kind: "pd" },
  { label: "CC BY", kind: "cc" },
  { label: "CC BY-SA", kind: "cc-sa" },
  { label: "PD", kind: "pd" },
  { label: "CC BY", kind: "cc" },
  { label: "CC0", kind: "pd" },
  { label: "CC BY-SA", kind: "cc-sa" },
  { label: "EDITORIAL", kind: "ed" },
  { label: "CC BY", kind: "cc" },
  { label: "PD", kind: "pd" },
  { label: "CC0", kind: "pd" },
  { label: "CC BY-SA", kind: "cc-sa" },
  { label: "PD", kind: "pd" },
  { label: "CC BY", kind: "cc" },
  { label: "CC0", kind: "pd" },
  { label: "CC BY-SA", kind: "cc-sa" },
  { label: "PD", kind: "pd" },
  { label: "CC BY", kind: "cc" },
  { label: "CC0", kind: "pd" },
  { label: "EDITORIAL", kind: "ed" },
  { label: "CC BY-SA", kind: "cc-sa" },
  { label: "PD", kind: "pd" },
  { label: "CC BY", kind: "cc" },
];

function stampColor(kind: "pd" | "cc" | "cc-sa" | "ed") {
  switch (kind) {
    case "pd":
      return "#6ea87a";
    case "cc":
      return "#9cd9ff";
    case "cc-sa":
      return "#d6b066";
    case "ed":
      return "#ff7a3d";
  }
}

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0a0a0c",
          color: "#f0f0f2",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', 'Roboto Mono', Consolas, monospace",
          position: "relative",
          padding: "64px 72px",
        }}
      >
        {/* scanline pattern */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            inset: 0,
            backgroundImage:
              "repeating-linear-gradient(to bottom, rgba(255,255,255,0.03) 0, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px)",
          }}
        />

        {/* top strip: brand + live dot */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#4ade80",
            }}
          />
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: "#8a8a95",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            webfetch. / license-first image layer
          </div>
        </div>

        {/* headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 40,
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 92,
              lineHeight: 1.02,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: "#f0f0f2",
              maxWidth: 1050,
            }}
          >
            webfetch.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 18,
              fontSize: 34,
              lineHeight: 1.25,
              color: "#c8c8cf",
              letterSpacing: "-0.015em",
              maxWidth: 980,
            }}
          >
            the license-first image layer for AI agents and humans
          </div>
        </div>

        {/* stamps grid */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 44,
            maxWidth: 1060,
            position: "relative",
          }}
        >
          {STAMPS.map((s, i) => {
            const color = stampColor(s.kind);
            return (
              <div
                key={`${s.label}-${i}`}
                style={{
                  display: "flex",
                  border: `2px solid ${color}`,
                  color,
                  padding: "6px 12px",
                  borderRadius: 4,
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  transform: `rotate(${((i % 5) - 2) * 1.4}deg)`,
                  background: `${color}12`,
                }}
              >
                {s.label}
              </div>
            );
          })}
        </div>

        {/* bottom url */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 72,
            bottom: 64,
            fontSize: 20,
            color: "#8a8a95",
            letterSpacing: "0.08em",
          }}
        >
          getwebfetch.com · one API · 24 providers · 0 UNKNOWN
        </div>

        {/* orange accent stripe */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 8,
            background: "#ff5a1f",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
