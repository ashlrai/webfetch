import { ImageResponse } from "next/og";

export const contentType = "image/png";

// Emit multiple PNG icons: 32 (favicon), 192 (PWA), 512 (PWA/maskable).
export function generateImageMetadata() {
  return [
    { id: "icon-32", size: { width: 32, height: 32 }, contentType: "image/png" },
    { id: "icon-192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "icon-512", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default function Icon({ id }: { id: string }) {
  const dim =
    id === "icon-512" ? 512 : id === "icon-192" ? 192 : 32;
  const fontSize = Math.round(dim * 0.55);
  const radius = Math.round(dim * 0.18);
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
          fontSize,
          fontWeight: 800,
          fontFamily: "monospace",
          letterSpacing: "-0.05em",
          borderRadius: radius,
        }}
      >
        wf.
      </div>
    ),
    { width: dim, height: dim },
  );
}
