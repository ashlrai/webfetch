import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "monospace",
          letterSpacing: "-0.05em",
          borderRadius: 6,
        }}
      >
        wf.
      </div>
    ),
    { ...size }
  );
}
