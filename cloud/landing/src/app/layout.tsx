import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://getwebfetch.com"),
  title: {
    default: "webfetch — the license-first image layer for AI agents",
    template: "%s — webfetch",
  },
  description:
    "One API, CLI, and MCP that federates 24 licensed image sources, falls through to a human-like browser when APIs miss, and always ships attribution.",
  applicationName: "webfetch",
  authors: [{ name: "Mason Wyatt", url: "https://ashlr.ai" }],
  creator: "AshlrAI",
  publisher: "AshlrAI",
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "webfetch — the license-first image layer for AI agents",
    description:
      "One API, CLI, and MCP that federates 24 licensed image sources, falls through to a human-like browser, and always ships attribution.",
    url: "https://getwebfetch.com",
    siteName: "webfetch",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "webfetch — the license-first image layer",
    description: "Federated, license-aware image search for AI agents and humans.",
    images: ["/og-image.png"],
    creator: "@masonwyatt",
    site: "@ashlr_ai",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon",
  },
  other: {
    "theme-color": "#ff5a1f",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Do NOT lock zoom — accessibility requires user scalability.
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0c" },
    { media: "(prefers-color-scheme: light)", color: "#0a0a0c" },
  ],
};

const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "AshlrAI",
  alternateName: "Ashlr AI",
  url: "https://ashlr.ai",
  logo: "https://getwebfetch.com/og-image.png",
  description:
    "AshlrAI is a small studio building developer infrastructure for the AI agent era.",
  founder: {
    "@type": "Person",
    name: "Mason Wyatt",
  },
  sameAs: ["https://ashlr.ai", "https://github.com/ashlrai", "https://x.com/ashlr_ai"],
};

const SOFTWARE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "webfetch",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  url: "https://getwebfetch.com",
  description:
    "The license-first image layer for AI agents. One API, CLI, and MCP federating 24 licensed image sources with attribution baked in.",
  publisher: {
    "@type": "Organization",
    name: "AshlrAI",
    url: "https://ashlr.ai",
  },
  screenshot: "https://getwebfetch.com/og-image.png",
  offers: [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
    { "@type": "Offer", name: "Pro", price: "19", priceCurrency: "USD" },
    { "@type": "Offer", name: "Team", price: "79", priceCurrency: "USD" },
  ],
};

const WEBSITE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "webfetch",
  url: "https://getwebfetch.com",
  description:
    "Documentation, pricing, and writing from the team building webfetch — the license-first image layer for AI agents.",
  publisher: { "@type": "Organization", name: "AshlrAI", url: "https://ashlr.ai" },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: "https://getwebfetch.com/docs?q={search_term_string}",
    },
    "query-input": "required name=search_term_string",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSONLD) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_JSONLD) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSONLD) }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body>
        <Nav />
        <main className="min-h-screen">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
