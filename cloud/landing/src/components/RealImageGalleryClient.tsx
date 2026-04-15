"use client";
import { useState } from "react";

export type GalleryItem = {
  file: string;
  sourceUrl: string;
  pageUrl: string;
  license: string;
  author: string;
  title: string;
  sourceProvider: string;
  attributionLine: string;
  fetchedInMs: number;
};

function stampClass(license: string) {
  const up = license.toUpperCase();
  if (up.includes("CC0") || up.includes("PUBLIC")) return "wf-stamp wf-stamp--green";
  return "wf-stamp";
}

function Card({ item }: { item: GalleryItem }) {
  const base = `/gallery/${item.file}`;
  const webp = `/gallery/${item.file.replace(/\.jpg$/, "-600.webp")}`;
  return (
    <div className="wf-gal-card group relative shrink-0 w-[260px] md:w-[300px] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] overflow-hidden">
      <div className="relative aspect-[4/5] overflow-hidden bg-[var(--color-bg)]">
        <picture>
          <source srcSet={webp} type="image/webp" />
          <img
            src={base}
            alt={item.title}
            loading="lazy"
            decoding="async"
            sizes="(max-width: 768px) 260px, 300px"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </picture>
        <span className={stampClass(item.license)} style={{ fontSize: 9 }}>
          {item.license}
        </span>

        {/* provider + timing badge */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <span className="px-2 py-0.5 rounded-md border border-[var(--color-border)] bg-[rgba(10,10,12,0.72)] backdrop-blur text-[10px] font-mono text-[var(--color-fg-muted)] uppercase tracking-wider">
            {item.sourceProvider}
          </span>
          <span className="px-2 py-0.5 rounded-md border border-[var(--color-border)] bg-[rgba(10,10,12,0.72)] backdrop-blur text-[10px] font-mono text-[var(--color-green)]">
            {item.fetchedInMs}ms
          </span>
        </div>

        {/* hover overlay with attribution */}
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-[rgba(10,10,12,0.92)] via-[rgba(10,10,12,0.5)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-4">
          <div className="text-[12px] font-mono text-[var(--color-fg)] leading-snug">
            {item.title}
          </div>
          <div className="mt-1 text-[11px] font-mono text-[var(--color-fg-dim)] leading-snug">
            {item.attributionLine}
          </div>
          <div className="mt-3 flex gap-2">
            <a
              href={item.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono px-2.5 py-1 rounded-md border border-[var(--color-border-hover)] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
            >
              view source →
            </a>
            <button
              type="button"
              className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-[#0a0a0c] font-semibold hover:brightness-110 transition"
            >
              use this image
            </button>
          </div>
        </div>
      </div>

      {/* below-image meta strip */}
      <div className="px-3 py-2 flex items-center justify-between gap-2 border-t border-[var(--color-border)]">
        <div className="min-w-0">
          <div className="text-[11px] font-mono text-[var(--color-fg)] truncate">
            {item.author}
          </div>
          <div className="text-[10px] font-mono text-[var(--color-fg-dim)] truncate">
            {item.title}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RealImageGalleryClient({ items }: { items: GalleryItem[] }) {
  const [paused, setPaused] = useState(false);
  // Duplicate items for seamless looping
  const loop = [...items, ...items];

  return (
    <section
      id="gallery"
      aria-label="Real licensed images fetched by webfetch"
      className="relative overflow-hidden py-16 md:py-20 border-y border-[var(--color-border)] bg-[var(--color-bg)]"
    >
      <div className="max-w-6xl mx-auto px-6 mb-10">
        <div className="text-[11px] font-mono text-[var(--color-accent)] uppercase tracking-[0.2em] mb-3">
          — real images, real licenses
        </div>
        <div className="flex items-end justify-between flex-wrap gap-4">
          <h2 className="font-mono text-[30px] md:text-[36px] font-semibold tracking-[-0.025em] leading-[1.1] max-w-3xl">
            Not stock photos.{" "}
            <span className="text-[var(--color-fg-dim)]">
              Real works, fetched live, stamped with provenance.
            </span>
          </h2>
          <div className="text-[12px] font-mono text-[var(--color-fg-dim)]">
            {items.length} results · ranked in 412ms · 0 UNKNOWN
          </div>
        </div>
        <p className="mt-4 text-[var(--color-fg-dim)] max-w-2xl leading-relaxed text-[14px]">
          Every image below was fetched from a public source with a verified license. Hover to see
          attribution and a link back to the origin. This is what your agent sees.
        </p>
      </div>

      <div
        className="wf-marquee relative"
        data-paused={paused ? "true" : "false"}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="wf-marquee-track flex gap-4 px-6">
          {loop.map((item, i) => (
            <Card key={`${item.file}-${i}`} item={item} />
          ))}
        </div>

        {/* gradient fades on edges */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-24 md:w-40 bg-gradient-to-r from-[var(--color-bg)] to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-24 md:w-40 bg-gradient-to-l from-[var(--color-bg)] to-transparent"
        />
      </div>
    </section>
  );
}
