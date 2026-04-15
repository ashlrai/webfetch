import type { Metadata } from "next";
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
  openGraph: {
    title: "webfetch — the license-first image layer for AI agents",
    description:
      "One API, CLI, and MCP that federates 24 licensed image sources, falls through to a human-like browser, and always ships attribution.",
    url: "https://getwebfetch.com",
    siteName: "webfetch",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "webfetch — the license-first image layer",
    description: "Federated, license-aware image search for AI agents and humans.",
    images: ["/og-image.png"],
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <Nav />
        <main className="min-h-screen">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
