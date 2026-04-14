import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  metadataBase: new URL("https://webfetch.dev"),
  title: {
    default: "webfetch — the license-first image layer for AI agents",
    template: "%s — webfetch",
  },
  description:
    "One API, CLI, and MCP that federates 19+ licensed image sources, falls through to a human-like browser when APIs miss, and always ships attribution.",
  openGraph: {
    title: "webfetch — the license-first image layer for AI agents",
    description:
      "One API, CLI, and MCP that federates 19+ licensed image sources, falls through to a human-like browser, and always ships attribution.",
    url: "https://webfetch.dev",
    siteName: "webfetch",
    images: [{ url: "/og-image.svg", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "webfetch — the license-first image layer",
    description: "Federated, license-aware image search for AI agents and humans.",
    images: ["/og-image.svg"],
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="min-h-screen">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
