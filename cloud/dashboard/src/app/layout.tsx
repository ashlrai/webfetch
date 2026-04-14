import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Nav from "@/components/nav";
import { getServerSession } from "@/lib/auth";
import { getOverview } from "@/lib/api";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "webfetch Cloud",
  description: "Manage API keys, usage, teams, and billing for webfetch.dev.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nav renders workspace switcher + live indicator; needs workspace list.
  // We do best-effort so unauthenticated pages (login/signup) still render.
  const session = await getServerSession().catch(() => null);
  let workspaces: { id: string; slug: string; name: string }[] = [];
  let activeSlug = "";
  if (session) {
    try {
      const overview = await getOverview();
      workspaces = overview.workspaces.map((w) => ({ id: w.id, slug: w.slug, name: w.name }));
      activeSlug = overview.workspace.slug;
    } catch {
      // swallow — nav falls back to an empty switcher
    }
  }

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body>
        <Nav workspaces={workspaces} activeSlug={activeSlug} authed={!!session} />
        <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-[1400px] px-6 py-10 text-xs" style={{ color: "var(--text-mute)" }}>
          <span className="mono">app.webfetch.dev</span>
          <span className="px-2">·</span>
          <a href="https://webfetch.dev/docs" className="hover:underline">docs</a>
          <span className="px-2">·</span>
          <a href="https://webfetch.dev/status" className="hover:underline">status</a>
          <span className="px-2">·</span>
          <a href="mailto:support@webfetch.dev" className="hover:underline">support</a>
        </footer>
      </body>
    </html>
  );
}
