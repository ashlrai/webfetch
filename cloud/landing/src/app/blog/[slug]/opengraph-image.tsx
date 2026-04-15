import { ImageResponse } from "next/og";
import { getAllPosts, getPostSource } from "@/lib/blog";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "webfetch blog post cover";

export async function generateImageMetadata() {
  return getAllPosts().map((p) => ({
    id: p.slug,
    alt: `${p.title} — webfetch blog`,
    contentType: "image/png",
    size,
  }));
}

export default async function OgImage({
  params,
}: {
  params: { slug: string };
}) {
  const post = getPostSource(params.slug);
  const title = post?.meta.title ?? "webfetch";
  const excerpt = post?.meta.excerpt ?? "";
  const readTime = post?.meta.readTime ?? "";
  const date = post?.meta.date ?? "";
  const truncatedTitle = title.length > 120 ? `${title.slice(0, 117)}...` : title;
  const truncatedExcerpt =
    excerpt.length > 160 ? `${excerpt.slice(0, 157)}...` : excerpt;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#0a0a0c",
        color: "#f0f0f2",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', 'Roboto Mono', Consolas, monospace",
        position: "relative",
        padding: "72px",
      }}
    >
      {/* scanline pattern */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage:
            "repeating-linear-gradient(to bottom, rgba(255,255,255,0.03) 0, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px)",
        }}
      />

      {/* left column */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: 780,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
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
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            webfetch. / blog
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 58,
              lineHeight: 1.08,
              fontWeight: 600,
              letterSpacing: "-0.035em",
              color: "#f0f0f2",
              maxWidth: 760,
            }}
          >
            {truncatedTitle}
          </div>
          {truncatedExcerpt ? (
            <div
              style={{
                display: "flex",
                marginTop: 22,
                fontSize: 22,
                lineHeight: 1.45,
                color: "#8a8a95",
                letterSpacing: "-0.01em",
                maxWidth: 760,
              }}
            >
              {truncatedExcerpt}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            gap: 14,
            fontSize: 18,
            color: "#8a8a95",
            alignItems: "center",
          }}
        >
          <span>{date}</span>
          <span style={{ color: "#4a4a55" }}>·</span>
          <span>{readTime}</span>
          <span style={{ color: "#4a4a55" }}>·</span>
          <span>by Mason Wyatt</span>
        </div>
      </div>

      {/* right column: rubber-stamp decoration */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          right: 72,
          top: 0,
          bottom: 0,
          width: 340,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: "rotate(-8deg)",
            border: "4px solid #d63a2f",
            color: "#d63a2f",
            padding: "28px 36px",
            borderRadius: 8,
            fontSize: 42,
            fontWeight: 700,
            letterSpacing: "0.16em",
            background: "rgba(214,58,47,0.06)",
            opacity: 0.9,
          }}
        >
          LICENSE — FIRST
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            alignItems: "center",
            justifyContent: "center",
            transform: "rotate(6deg)",
            border: "3px solid #2a5a3a",
            color: "#6ea87a",
            padding: "14px 22px",
            borderRadius: 6,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "0.14em",
            background: "rgba(42,90,58,0.08)",
          }}
        >
          CC0 · CC-BY · PD
        </div>
      </div>

      {/* footer stripe */}
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
    </div>,
    {
      ...size,
    },
  );
}
