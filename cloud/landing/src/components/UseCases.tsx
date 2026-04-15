"use client";
import { useState } from "react";

type UseCase = {
  id: "blog" | "slide" | "product";
  label: string;
  title: string;
  blurb: string;
  image: string;
  imageAlt: string;
  sourceLang: "html" | "markdown" | "jsx";
  source: string;
  preview: React.ReactNode;
};

const BLOG_IMG = "/gallery/starry-night-van-gogh.jpg";
const SLIDE_IMG = "/gallery/earth-apollo-17-blue-marble.jpg";
const PRODUCT_IMG = "/gallery/hope-diamond.jpg";

const BLOG_SOURCE = `<article>
  <h1>A short history of the night sky</h1>
  <figure>
    <img src="/assets/starry-night.jpg"
         alt="The Starry Night by Vincent van Gogh" />
    <figcaption>
      <em>The Starry Night</em> (1889) — Vincent van Gogh.
      Public Domain · <a href="https://commons.wikimedia.org/...">source</a>
    </figcaption>
  </figure>
  <p>Long before telescopes...</p>
</article>`;

const SLIDE_SOURCE = `---
title: Why we go
image: earth-apollo-17.jpg
image_credit: NASA · Apollo 17 · Public Domain
---

# Why we go

> "The Earth is a very small stage in a vast cosmic arena."
> — Carl Sagan`;

const PRODUCT_SOURCE = `<ProductHero>
  <Image
    src="/assets/hope-diamond.jpg"
    alt="The Hope Diamond"
    license="Public Domain"
    credit="Smithsonian NMNH · David Bjorgen"
  />
  <LicenseBadge tag="PUBLIC DOMAIN" verified />
</ProductHero>`;

const CASES: UseCase[] = [
  {
    id: "blog",
    label: "Blog post",
    title: "Ship-ready HTML with figcaption",
    blurb:
      "Attribution lives next to the image, not in a spreadsheet. The sidecar becomes your figcaption.",
    image: BLOG_IMG,
    imageAlt: "Starry Night by Van Gogh",
    sourceLang: "html",
    source: BLOG_SOURCE,
    preview: (
      <div className="p-5 md:p-6 bg-[var(--color-bg-elev)] h-full">
        <div className="text-[10px] font-mono text-[var(--color-fg-dim)] uppercase tracking-wider mb-3">
          essays / notebook
        </div>
        <h3 className="text-[18px] md:text-[20px] font-semibold tracking-tight leading-tight mb-3 text-[var(--color-fg)]">
          A short history of the night sky
        </h3>
        <figure className="rounded-md overflow-hidden border border-[var(--color-border)]">
          <img
            src={BLOG_IMG}
            alt="The Starry Night (1889) by Vincent van Gogh — swirling night sky over a village, Public Domain via Wikimedia Commons"
            loading="lazy"
            decoding="async"
            className="w-full aspect-[16/10] object-cover"
          />
          <figcaption className="px-3 py-2 text-[11px] font-mono text-[var(--color-fg-dim)] bg-[var(--color-bg)] border-t border-[var(--color-border)]">
            <em>The Starry Night</em> (1889) — Vincent van Gogh · Public Domain · via Wikimedia Commons
          </figcaption>
        </figure>
        <p className="mt-3 text-[12px] text-[var(--color-fg-muted)] leading-relaxed line-clamp-3">
          Long before telescopes, before satellites, before we knew that the smear of light across
          the summer sky was our own galaxy seen edge-on, people painted what they saw...
        </p>
      </div>
    ),
  },
  {
    id: "slide",
    label: "Slide deck",
    title: "Full-bleed slide with corner credit",
    blurb:
      "Export attribution-safe hero slides from a single MCP call. The credit line is generated, not copy-pasted.",
    image: SLIDE_IMG,
    imageAlt: "Earth from Apollo 17",
    sourceLang: "markdown",
    source: SLIDE_SOURCE,
    preview: (
      <div className="relative h-full min-h-[280px] bg-black overflow-hidden">
        <img
          src={SLIDE_IMG}
          alt="The Blue Marble — Earth photographed by the Apollo 17 crew in 1972, Public Domain (NASA)"
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/20" />
        <div className="relative z-10 h-full flex flex-col justify-between p-5 md:p-7 min-h-[280px]">
          <div className="text-[10px] font-mono text-white/60 uppercase tracking-[0.2em]">
            why we go · slide 01
          </div>
          <div>
            <h3 className="font-mono text-[28px] md:text-[36px] font-semibold tracking-tight leading-[1.0] text-white">
              Why we go.
            </h3>
            <div className="mt-2 text-[12px] font-mono text-white/70 italic max-w-sm leading-snug">
              &ldquo;The Earth is a very small stage in a vast cosmic arena.&rdquo;
              <br />
              <span className="not-italic">— Carl Sagan</span>
            </div>
          </div>
          <div className="text-[10px] font-mono text-white/50 tracking-wider">
            NASA · Apollo 17 · Public Domain
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "product",
    label: "Product page",
    title: "Hero image with a verified license badge",
    blurb:
      "E-commerce and marketing pages get a visible license pedigree — no legal-scramble before launch.",
    image: PRODUCT_IMG,
    imageAlt: "The Hope Diamond",
    sourceLang: "jsx",
    source: PRODUCT_SOURCE,
    preview: (
      <div className="p-5 md:p-6 bg-[var(--color-bg-elev)] h-full">
        <div className="text-[10px] font-mono text-[var(--color-fg-dim)] uppercase tracking-wider mb-3">
          shop · featured
        </div>
        <div className="grid grid-cols-[1fr_1fr] gap-4 items-start">
          <div className="rounded-md overflow-hidden border border-[var(--color-border)] bg-black aspect-square">
            <img
              src={PRODUCT_IMG}
              alt="The Hope Diamond — deep-blue 45.52-carat gemstone at the Smithsonian, Public Domain (photo by David Bjorgen, NMNH)"
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h3 className="font-mono text-[16px] font-semibold text-[var(--color-fg)] leading-tight">
              The Hope Diamond
            </h3>
            <div className="mt-1 text-[11px] font-mono text-[var(--color-fg-dim)]">
              Natural History Museum
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-[#2a5a3a] text-[10px] font-mono text-[#6ea87a] bg-[rgba(42,90,58,0.08)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" />
              LICENSE VERIFIED · PUBLIC DOMAIN
            </div>
            <div className="mt-3 text-[11px] font-mono text-[var(--color-fg-dim)] leading-snug">
              credit: Smithsonian NMNH · David Bjorgen
            </div>
          </div>
        </div>
      </div>
    ),
  },
];

function SourceBlock({ source, lang }: { source: string; lang: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-code-bg)] overflow-hidden mt-3">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-elev-2)]">
        <span className="text-[10px] font-mono text-[var(--color-fg-dim)] uppercase tracking-wider">
          output · {lang}
        </span>
        <span className="text-[10px] font-mono text-[var(--color-green)]">attribution-ready</span>
      </div>
      <pre className="px-3 py-3 text-[11px] leading-relaxed text-[var(--color-fg-muted)] font-mono overflow-x-auto max-h-[220px]">
        {source}
      </pre>
    </div>
  );
}

function Card({ uc }: { uc: UseCase }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="wf-card h-full flex flex-col p-0 overflow-hidden">
      <div className="border-b border-[var(--color-border)]">{uc.preview}</div>
      <div className="p-5 flex-1 flex flex-col">
        <div className="text-[10px] font-mono text-[var(--color-accent)] uppercase tracking-wider mb-1">
          {uc.label}
        </div>
        <div className="font-mono text-[15px] font-semibold text-[var(--color-fg)] leading-snug">
          {uc.title}
        </div>
        <p className="mt-2 text-[13px] text-[var(--color-fg-dim)] leading-relaxed flex-1">
          {uc.blurb}
        </p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-3 self-start text-[11px] font-mono text-[var(--color-accent)] hover:underline"
          aria-expanded={open}
        >
          {open ? "hide source ↑" : "view source ↓"}
        </button>
        {open && <SourceBlock source={uc.source} lang={uc.sourceLang} />}
      </div>
    </div>
  );
}

export function UseCases() {
  return (
    <section
      id="use-cases"
      className="max-w-6xl mx-auto px-6 py-20 md:py-24"
      aria-label="What you do with webfetch"
    >
      <div className="text-[11px] font-mono text-[var(--color-accent)] uppercase tracking-[0.2em] mb-3">
        — what you do with it
      </div>
      <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
        <h2 className="font-mono text-[30px] md:text-[36px] font-semibold tracking-[-0.025em] leading-[1.1] max-w-3xl">
          We don&apos;t ship URLs.{" "}
          <span className="text-[var(--color-fg-dim)]">We ship attribution-ready output.</span>
        </h2>
        <div className="text-[12px] font-mono text-[var(--color-fg-dim)]">
          one fetch → three surfaces
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {CASES.map((uc) => (
          <Card key={uc.id} uc={uc} />
        ))}
      </div>
    </section>
  );
}
