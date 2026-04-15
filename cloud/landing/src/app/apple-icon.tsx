import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0c",
          color: "#ff5a1f",
          fontSize: 96,
          fontWeight: 700,
          fontFamily: "monospace",
          letterSpacing: "-0.05em",
          borderRadius: 32,
        }}
      >
        wf.
      </div>
    ),
    { ...size }
  );
}
